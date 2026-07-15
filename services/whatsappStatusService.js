const crypto = require("crypto");
const { META_MESSAGE_STATUSES, META_STATUS_RANK } = require("../config/whatsappStates");
const { AuditLog, FollowUp, Message, WhatsAppWebhookEvent, sequelize } = require("../models");

const SUPPORTED_WEBHOOK_STATUSES = new Set(["sent", "delivered", "read", "failed"]);
const MAX_ERROR_LENGTH = 2000;

const extractMetaStatuses = (payload) => {
  if (!Array.isArray(payload?.entry)) return [];
  return payload.entry.flatMap((entry) => {
    if (!Array.isArray(entry?.changes)) return [];
    return entry.changes.flatMap((change) =>
      Array.isArray(change?.value?.statuses) ? change.value.statuses : []
    );
  });
};

const parseMetaTimestamp = (value, receivedAt) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    const fallback = new Date(receivedAt);
    return Number.isNaN(fallback.getTime())
      ? { valid: false, date: null, usedFallback: false }
      : { valid: true, date: fallback, usedFallback: true };
  }

  const seconds = Number(value);
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(seconds) || seconds <= 0 || Number.isNaN(date.getTime())) {
    return { valid: false, date: null, usedFallback: false };
  }
  return { valid: true, date, usedFallback: false };
};

const extractMetaError = (errors) => {
  const error = Array.isArray(errors) ? errors[0] : null;
  if (!error || typeof error !== "object") return { code: null, message: null };

  const code =
    error.code === undefined || error.code === null ? null : String(error.code).slice(0, 80);
  const message = [error.title, error.message, error.error_data?.details]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join(" - ")
    .slice(0, MAX_ERROR_LENGTH);
  return { code, message: message || null };
};

const statusKey = (status) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(status ?? null))
    .digest("hex");

const parseProcessedKeys = (value) => {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
};

const latestKnownTimestamp = (record) => {
  const values = [record.accepted_at, record.sent_at, record.delivered_at, record.read_at]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
};

const transitionDecision = (currentStatus, incomingStatus, timestamp, record) => {
  if (currentStatus === "failed") return { apply: false, reason: "terminal_failed" };

  if (incomingStatus === "failed") {
    if (currentStatus === "delivered" || currentStatus === "read") {
      return { apply: false, reason: "late_failed_after_success" };
    }
    const latestTimestamp = latestKnownTimestamp(record);
    if (latestTimestamp !== null && timestamp.getTime() < latestTimestamp) {
      return { apply: false, reason: "stale_timestamp" };
    }
    return { apply: true };
  }

  const currentRank = META_STATUS_RANK[currentStatus];
  const incomingRank = META_STATUS_RANK[incomingStatus];
  if (currentRank !== undefined && currentRank >= incomingRank) {
    return { apply: false, reason: "duplicate_or_regression" };
  }

  const latestTimestamp = latestKnownTimestamp(record);
  if (latestTimestamp !== null && timestamp.getTime() < latestTimestamp) {
    return { apply: false, reason: "stale_timestamp" };
  }
  return { apply: true };
};

const applyMessageStatus = (message, status, timestamp, metaError) => {
  message.status = status;
  message.meta_status = status;
  message[`${status}_at`] = timestamp;
  if (status === "failed") {
    message.meta_error_code = metaError.code;
    message.meta_error_message = metaError.message;
  }
};

const applyFollowUpStatus = (followUp, status, timestamp, metaError) => {
  followUp.meta_status = status;
  followUp[`${status}_at`] = timestamp;
  if (status === "delivered" || status === "read") {
    followUp.status = "completed";
    followUp.processing_started_at = null;
    followUp.last_error = null;
  } else if (status === "failed") {
    followUp.status = "failed";
    followUp.processing_started_at = null;
    followUp.meta_error_code = metaError.code;
    followUp.meta_error_message = metaError.message;
    followUp.last_error = metaError.message || "Meta reported WhatsApp delivery failure";
  } else if (status === "sent" && followUp.status !== "completed") {
    followUp.status = "processing";
  }
};

const appendAuditResult = (event, key, counter, detail) => {
  const keys = parseProcessedKeys(event.processed_status_keys_json);
  keys.push(key);
  event.processed_status_keys_json = JSON.stringify(keys);
  event[counter] = Number(event[counter] || 0) + 1;

  let summary = [];
  try {
    const parsed = JSON.parse(event.processing_summary_json || "[]");
    summary = Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    summary = [];
  }
  summary.push(detail);
  event.processing_summary_json = JSON.stringify(summary);
};

const processOneStatus = async ({ eventId, rawStatus }) =>
  sequelize.transaction(async (transaction) => {
    const event = await WhatsAppWebhookEvent.findByPk(eventId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!event) throw new Error("WhatsApp webhook receipt not found");

    const key = statusKey(rawStatus);
    if (parseProcessedKeys(event.processed_status_keys_json).includes(key)) {
      return { outcome: "already_processed" };
    }

    const wamid = String(rawStatus?.id || "").trim();
    const status = String(rawStatus?.status || "")
      .trim()
      .toLowerCase();
    const auditBase = { wamid: wamid || null, status: status || null };

    if (!wamid || !SUPPORTED_WEBHOOK_STATUSES.has(status)) {
      appendAuditResult(event, key, "ignored_count", {
        ...auditBase,
        outcome: "ignored",
        reason: !wamid ? "missing_wamid" : "unsupported_status"
      });
      await event.save({ transaction });
      return { outcome: "ignored" };
    }

    const parsedTimestamp = parseMetaTimestamp(rawStatus.timestamp, event.received_at);
    if (!parsedTimestamp.valid) {
      appendAuditResult(event, key, "failed_count", {
        ...auditBase,
        outcome: "failed",
        reason: "invalid_timestamp"
      });
      event.processing_error = "One or more Meta statuses contained an invalid timestamp";
      await event.save({ transaction });
      return { outcome: "failed" };
    }

    const message = await Message.findOne({
      where: { meta_message_id: wamid },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!message) {
      const identifiableFollowUp = await FollowUp.findOne({
        where: { provider_message_id: wamid },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (identifiableFollowUp && !["completed", "failed"].includes(identifiableFollowUp.status)) {
        identifiableFollowUp.status = "needs_review";
        identifiableFollowUp.review_reason = "Meta status received without a matching Message row";
        await identifiableFollowUp.save({ transaction });
      }
      appendAuditResult(event, key, "unmatched_count", {
        ...auditBase,
        outcome: "unmatched",
        followup_identified: Boolean(identifiableFollowUp)
      });
      await event.save({ transaction });
      return { outcome: "unmatched" };
    }

    const decision = transitionDecision(
      message.meta_status ||
        (META_MESSAGE_STATUSES.includes(message.status) ? message.status : null),
      status,
      parsedTimestamp.date,
      message
    );
    if (!decision.apply) {
      appendAuditResult(event, key, "ignored_count", {
        ...auditBase,
        outcome: "ignored",
        reason: decision.reason,
        timestamp_fallback: parsedTimestamp.usedFallback
      });
      await event.save({ transaction });
      return { outcome: "ignored" };
    }

    const metaError = extractMetaError(rawStatus.errors);
    applyMessageStatus(message, status, parsedTimestamp.date, metaError);
    await message.save({ transaction });

    const followUp = message.followup_id
      ? await FollowUp.findByPk(message.followup_id, {
          transaction,
          lock: transaction.LOCK.UPDATE
        })
      : null;
    if (followUp) {
      const oldFollowUpStatus = followUp.status;
      applyFollowUpStatus(followUp, status, parsedTimestamp.date, metaError);
      await followUp.save({ transaction });
      if (
        oldFollowUpStatus !== followUp.status &&
        ["completed", "failed"].includes(followUp.status)
      ) {
        await AuditLog.create(
          {
            user_id: null,
            action: "FOLLOWUP_WEBHOOK_RECONCILED",
            entity: "followup",
            entity_id: followUp.id,
            ip: null,
            meta_json: JSON.stringify({
              old_status: oldFollowUpStatus,
              new_status: followUp.status,
              reason: status,
              source: "webhook_reconciliation",
              note: null,
              wamid
            })
          },
          { transaction }
        );
      }
    }

    appendAuditResult(event, key, "processed_count", {
      ...auditBase,
      outcome: "processed",
      recipient_id: rawStatus.recipient_id || null,
      timestamp_fallback: parsedTimestamp.usedFallback,
      conversation_id: rawStatus.conversation?.id || null,
      conversation_origin_type: rawStatus.conversation?.origin?.type || null,
      pricing_model: rawStatus.pricing?.pricing_model || null,
      pricing_category: rawStatus.pricing?.category || null,
      billable: typeof rawStatus.pricing?.billable === "boolean" ? rawStatus.pricing.billable : null
    });
    await event.save({ transaction });
    return { outcome: "processed" };
  });

const deriveEventState = (event) => {
  const successful =
    Number(event.processed_count || 0) +
    Number(event.messages_matched || 0) +
    Number(event.messages_unmatched || 0);
  const ignored =
    Number(event.ignored_count || 0) +
    Number(event.unmatched_count || 0) +
    Number(event.messages_ignored || 0);
  const failed = Number(event.failed_count || 0) + Number(event.messages_failed || 0);
  if (successful > 0 && ignored + failed > 0) return "partially_processed";
  if (successful > 0) return "processed";
  if (failed > 0 && ignored > 0) return "partially_processed";
  if (failed > 0) return "failed";
  return "ignored";
};

const processWebhookStatuses = async ({ event, payload }) => {
  const statuses = extractMetaStatuses(payload);
  await event.update({ statuses_found: statuses.length });

  const technicalErrors = [];
  for (const rawStatus of statuses) {
    try {
      await processOneStatus({ eventId: event.id, rawStatus });
    } catch (error) {
      technicalErrors.push(error);
    }
  }

  await event.reload();
  event.state = deriveEventState(event);
  event.processed_at = new Date();
  if (technicalErrors.length > 0) {
    event.state = Number(event.processed_count || 0) > 0 ? "partially_processed" : "failed";
    event.processing_error = String(
      technicalErrors.at(-1).message || "Internal status processing error"
    ).slice(0, MAX_ERROR_LENGTH);
  }
  await event.save();

  if (technicalErrors.length > 0) {
    const error = new Error("WhatsApp status processing is temporarily unavailable");
    error.statusCode = 500;
    throw error;
  }

  return {
    state: event.state,
    statusesFound: event.statuses_found,
    processed: event.processed_count,
    ignored: event.ignored_count,
    unmatched: event.unmatched_count,
    failed: event.failed_count
  };
};

module.exports = {
  deriveEventState,
  extractMetaError,
  extractMetaStatuses,
  parseMetaTimestamp,
  processWebhookStatuses,
  transitionDecision
};
