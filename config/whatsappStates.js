const MESSAGE_DIRECTIONS = ["outbound", "inbound"];
const MESSAGE_TYPES = ["initial", "followup", "group", "activation", "recovery", "inbound"];
const META_MESSAGE_STATUSES = ["accepted", "sent", "delivered", "read", "failed"];
const MESSAGE_STATUSES = ["pending", "received", "skipped_opt_out", ...META_MESSAGE_STATUSES];
const FOLLOWUP_STATUSES = ["pending", "processing", "needs_review", "completed", "failed"];
const WEBHOOK_EVENT_TYPES = ["status", "message", "mixed", "unknown"];
const WEBHOOK_EVENT_STATES = ["received", "processed", "partially_processed", "ignored", "failed"];
const META_STATUS_RANK = Object.freeze({ accepted: 0, sent: 1, delivered: 2, read: 3 });
const CONSENT_ACTIONS = ["opt_in", "opt_out"];
const CONSENT_CONTACT_TYPES = ["lead", "student"];

module.exports = {
  MESSAGE_DIRECTIONS,
  MESSAGE_TYPES,
  META_MESSAGE_STATUSES,
  META_STATUS_RANK,
  MESSAGE_STATUSES,
  FOLLOWUP_STATUSES,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_EVENT_STATES,
  CONSENT_ACTIONS,
  CONSENT_CONTACT_TYPES
};
