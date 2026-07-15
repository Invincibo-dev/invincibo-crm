const crypto = require("crypto");
const { Lead, Message, Student, WhatsAppWebhookEvent, sequelize } = require("../models");
const { isOptOutMessage, recordOptOut } = require("./whatsappConsentService");
const { normalizeWhatsAppPhone } = require("./whatsappPhoneService");
const { deriveEventState, parseMetaTimestamp } = require("./whatsappStatusService");

const extractInboundMessages = (payload) => {
  if (!Array.isArray(payload?.entry)) return [];
  return payload.entry.flatMap((entry) =>
    Array.isArray(entry?.changes)
      ? entry.changes.flatMap((change) => {
          const value = change?.value || {};
          if (!Array.isArray(value.messages)) return [];
          return value.messages.map((message) => {
            const contact = Array.isArray(value.contacts)
              ? value.contacts.find(
                  (candidate) =>
                    normalizeWhatsAppPhone(candidate?.wa_id) ===
                    normalizeWhatsAppPhone(message?.from)
                )
              : null;
            return {
              raw: message,
              profileName: contact?.profile?.name || null,
              metadata: value.metadata || null
            };
          });
        })
      : []
  );
};

const parseJsonArray = (value) => {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
};

const inboundKey = (message) =>
  message?.id
    ? `wamid:${String(message.id).trim()}`
    : `hash:${crypto
        .createHash("sha256")
        .update(JSON.stringify(message ?? null))
        .digest("hex")}`;

const findContactByPhone = async (phone, transaction) => {
  const lead = await Lead.findOne({
    where: { whatsapp_phone_normalized: phone },
    order: [["id", "ASC"]],
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  if (lead) return { contact: lead, contactType: "lead" };

  const student = await Student.findOne({
    where: { whatsapp_phone_normalized: phone },
    order: [["id", "ASC"]],
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  if (student) return { contact: student, contactType: "student" };

  // Compatibility for rows created before the normalized phone column existed.
  const legacyLeads = await Lead.findAll({ order: [["id", "ASC"]], transaction });
  const legacyLead = legacyLeads.find(
    (candidate) => normalizeWhatsAppPhone(candidate.phone) === phone
  );
  if (legacyLead) {
    legacyLead.whatsapp_phone_normalized = phone;
    await legacyLead.save({ transaction });
    return { contact: legacyLead, contactType: "lead" };
  }
  const legacyStudents = await Student.findAll({ order: [["id", "ASC"]], transaction });
  const legacyStudent = legacyStudents.find(
    (candidate) => normalizeWhatsAppPhone(candidate.phone) === phone
  );
  if (legacyStudent) {
    legacyStudent.whatsapp_phone_normalized = phone;
    await legacyStudent.save({ transaction });
    return { contact: legacyStudent, contactType: "student" };
  }
  return { contact: null, contactType: null };
};

const appendInboundAudit = (event, key, counter, detail) => {
  const keys = parseJsonArray(event.processed_message_keys_json);
  keys.push(key);
  event.processed_message_keys_json = JSON.stringify(keys);
  event[counter] = Number(event[counter] || 0) + 1;
  const summary = parseJsonArray(event.processing_summary_json);
  summary.push({ channel: "inbound_message", ...detail });
  event.processing_summary_json = JSON.stringify(summary);
};

const processOneInbound = async ({ eventId, extracted }) =>
  sequelize.transaction(async (transaction) => {
    const event = await WhatsAppWebhookEvent.findByPk(eventId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!event) throw new Error("WhatsApp webhook receipt not found");

    const raw = extracted.raw || {};
    const key = inboundKey(raw);
    if (parseJsonArray(event.processed_message_keys_json).includes(key)) {
      return { outcome: "already_processed" };
    }

    const wamid = String(raw.id || "").trim();
    const messageType = String(raw.type || "")
      .trim()
      .toLowerCase();
    const phone = normalizeWhatsAppPhone(raw.from);
    const auditBase = { wamid: wamid || null, type: messageType || null, phone };

    if (!wamid || !phone) {
      appendInboundAudit(event, key, "messages_failed", {
        ...auditBase,
        outcome: "failed",
        reason: !wamid ? "missing_wamid" : "invalid_phone"
      });
      await event.save({ transaction });
      return { outcome: "failed" };
    }

    if (messageType !== "text") {
      appendInboundAudit(event, key, "messages_ignored", {
        ...auditBase,
        outcome: "ignored",
        reason: "unsupported_message_type"
      });
      await event.save({ transaction });
      return { outcome: "ignored" };
    }

    const text = String(raw.text?.body || "").trim();
    if (!text) {
      appendInboundAudit(event, key, "messages_ignored", {
        ...auditBase,
        outcome: "ignored",
        reason: "empty_text"
      });
      await event.save({ transaction });
      return { outcome: "ignored" };
    }

    const timestamp = parseMetaTimestamp(raw.timestamp, event.received_at);
    if (!timestamp.valid) {
      appendInboundAudit(event, key, "messages_failed", {
        ...auditBase,
        outcome: "failed",
        reason: "invalid_timestamp"
      });
      await event.save({ transaction });
      return { outcome: "failed" };
    }

    const { contact, contactType } = await findContactByPhone(phone, transaction);
    const [message, created] = await Message.findOrCreate({
      where: { meta_message_id: wamid },
      defaults: {
        lead_id: contactType === "lead" ? contact.id : null,
        student_id: contactType === "student" ? contact.id : null,
        message: text,
        type: "inbound",
        direction: "inbound",
        status: "received",
        meta_message_id: wamid,
        source_phone: phone,
        source: "whatsapp",
        inbound_message_type: messageType,
        context_message_id: raw.context?.id || null,
        webhook_event_id: event.id,
        received_at: timestamp.date,
        created_at: new Date()
      },
      transaction
    });
    if (!created) {
      appendInboundAudit(event, key, "messages_ignored", {
        ...auditBase,
        outcome: "ignored",
        reason: "duplicate_wamid"
      });
      await event.save({ transaction });
      return { outcome: "ignored", message };
    }

    const optOut = Boolean(contact && isOptOutMessage(text));
    if (optOut) {
      await recordOptOut(
        {
          contact,
          contactType,
          phone,
          metaMessageId: wamid,
          webhookEventId: event.id,
          text,
          eventAt: timestamp.date,
          context: { profile_name: extracted.profileName || null }
        },
        transaction
      );
      event.messages_opt_out = Number(event.messages_opt_out || 0) + 1;
    }

    const counter = contact ? "messages_matched" : "messages_unmatched";
    appendInboundAudit(event, key, counter, {
      ...auditBase,
      outcome: contact ? "matched" : "unmatched",
      contact_type: contactType,
      contact_id: contact?.id || null,
      opt_out: optOut,
      timestamp_fallback: timestamp.usedFallback,
      profile_name: extracted.profileName,
      display_phone_number: extracted.metadata?.display_phone_number || null,
      phone_number_id: extracted.metadata?.phone_number_id || null
    });
    await event.save({ transaction });
    return { outcome: contact ? "matched" : "unmatched", optOut };
  });

const processInboundMessages = async ({ event, payload }) => {
  const messages = extractInboundMessages(payload);
  await event.update({ messages_found: messages.length });

  const technicalErrors = [];
  for (const extracted of messages) {
    try {
      await processOneInbound({ eventId: event.id, extracted });
    } catch (error) {
      technicalErrors.push(error);
    }
  }

  await event.reload();
  event.state = deriveEventState(event);
  event.processed_at = new Date();
  if (technicalErrors.length > 0) {
    const successful = Number(event.processed_count || 0) + Number(event.messages_matched || 0);
    event.state = successful > 0 ? "partially_processed" : "failed";
    event.processing_error = String(
      technicalErrors.at(-1).message || "Internal inbound processing error"
    ).slice(0, 2000);
  }
  await event.save();

  if (technicalErrors.length > 0) {
    const error = new Error("WhatsApp inbound processing is temporarily unavailable");
    error.statusCode = 500;
    throw error;
  }
  return event;
};

module.exports = { extractInboundMessages, findContactByPhone, processInboundMessages };
