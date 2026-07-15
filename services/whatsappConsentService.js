const { WhatsAppConsentEvent, sequelize } = require("../models");
const { normalizeWhatsAppPhone } = require("./whatsappPhoneService");

const OPT_OUT_KEYWORDS = Object.freeze(["STOP", "ARRET", "PA STOP", "SISPANN", "UNSUBSCRIBE"]);

const normalizeConsentText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s.,!?;:]+|[\s.,!?;:]+$/g, "")
    .trim();

const isOptOutMessage = (text) => {
  const normalized = normalizeConsentText(text);
  if (OPT_OUT_KEYWORDS.includes(normalized)) return true;

  // Only an anchored, explicit request is accepted. A sentence such as
  // "PA STOP TRAVAY LA" therefore remains a normal inbound message.
  return /^(TANPRI )?(STOP|SISPANN|ARRET) (VOYE|VOYE M|ANVOYE|ENVOYE) (MESAJ|MESSAGE)( SA YO| YO| SA)?$/.test(
    normalized
  );
};

const canSendWhatsApp = (contact, messageCategory = "marketing") => {
  const allowed = Boolean(
    contact &&
    contact.whatsapp_opt_in === true &&
    contact.whatsapp_opt_in_at &&
    !contact.whatsapp_opt_out_at
  );
  return {
    allowed,
    status: allowed ? "allowed" : "skipped_opt_out",
    category: messageCategory,
    reason: allowed ? null : "Explicit WhatsApp opt-in is required and opt-out must be absent"
  };
};

const createConsentEvidence = ({ text, context, externalEvidence }) =>
  JSON.stringify({
    normalized_text: text ? normalizeConsentText(text).slice(0, 255) : null,
    context: context || null,
    external_evidence: externalEvidence || null
  });

const createConsentEvent = async (
  {
    contactType,
    contact,
    action,
    source,
    phone,
    metaMessageId = null,
    webhookEventId = null,
    createdBy = null,
    text = null,
    eventAt,
    context = null,
    externalEvidence = null
  },
  transaction
) => {
  const normalizedPhone = normalizeWhatsAppPhone(phone || contact.phone);
  if (!normalizedPhone) throw new Error("A valid international WhatsApp phone is required");
  const occurredAt = new Date(eventAt);
  if (Number.isNaN(occurredAt.getTime())) throw new Error("A valid consent event date is required");

  const values = {
    contact_type: contactType,
    contact_id: contact.id,
    action,
    source,
    phone: normalizedPhone,
    normalized_text: text ? normalizeConsentText(text).slice(0, 255) : null,
    meta_message_id: metaMessageId,
    webhook_event_id: webhookEventId,
    created_by: createdBy,
    evidence_json: createConsentEvidence({ text, context, externalEvidence }),
    event_at: occurredAt,
    processed_at: new Date()
  };

  if (metaMessageId) {
    return WhatsAppConsentEvent.findOrCreate({
      where: { meta_message_id: metaMessageId, action },
      defaults: values,
      transaction
    });
  }
  return [await WhatsAppConsentEvent.create(values, { transaction }), true];
};

const recordOptOut = async (options, transaction) => {
  const { contact } = options;
  const eventAt = new Date(options.eventAt);
  contact.whatsapp_opt_in = false;
  if (!contact.whatsapp_opt_out_at) {
    contact.whatsapp_opt_out_at = eventAt;
    contact.whatsapp_opt_out_source = "inbound_whatsapp";
  }
  await contact.save({ transaction });

  return createConsentEvent(
    {
      ...options,
      action: "opt_out",
      source: "inbound_whatsapp",
      eventAt
    },
    transaction
  );
};

const recordExplicitOptIn = async (options) => {
  const {
    contact,
    contactType,
    source,
    eventAt,
    createdBy = null,
    externalEvidence = null,
    transaction: suppliedTransaction = null
  } = options;
  if (!contact || !contactType || !String(source || "").trim()) {
    throw new Error("contact, contactType and consent source are required");
  }
  if (!createdBy && !externalEvidence) {
    throw new Error("Explicit opt-in requires an authenticated actor or external evidence");
  }

  const work = async (transaction) => {
    const occurredAt = new Date(eventAt);
    if (Number.isNaN(occurredAt.getTime())) throw new Error("A valid opt-in date is required");
    contact.whatsapp_opt_in = true;
    contact.whatsapp_opt_in_at = occurredAt;
    contact.whatsapp_opt_in_source = String(source).trim();
    contact.whatsapp_opt_out_at = null;
    contact.whatsapp_opt_out_source = null;
    await contact.save({ transaction });
    return createConsentEvent(
      {
        ...options,
        action: "opt_in",
        source: String(source).trim(),
        eventAt: occurredAt
      },
      transaction
    );
  };

  return suppliedTransaction ? work(suppliedTransaction) : sequelize.transaction(work);
};

module.exports = {
  OPT_OUT_KEYWORDS,
  canSendWhatsApp,
  isOptOutMessage,
  normalizeConsentText,
  recordExplicitOptIn,
  recordOptOut
};
