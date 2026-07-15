const crypto = require("crypto");
const { WhatsAppWebhookEvent } = require("../models");

const createHttpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const requireSecret = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw createHttpError("WhatsApp webhook configuration error", 503);
  }
  return value;
};

const safeBufferEqual = (left, right) => {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
};

const verifyChallengeToken = (providedToken) => {
  const expectedToken = Buffer.from(requireSecret("WHATSAPP_WEBHOOK_VERIFY_TOKEN"), "utf8");
  const receivedToken = Buffer.from(String(providedToken || ""), "utf8");
  return safeBufferEqual(receivedToken, expectedToken);
};

const verifyMetaSignature = (rawBody, signatureHeader) => {
  if (!Buffer.isBuffer(rawBody)) {
    throw createHttpError("Invalid WhatsApp webhook signature", 401);
  }

  const match = /^sha256=([a-f0-9]{64})$/i.exec(String(signatureHeader || ""));
  if (!match) {
    throw createHttpError("Invalid WhatsApp webhook signature", 401);
  }

  const expectedHex = crypto
    .createHmac("sha256", requireSecret("WHATSAPP_APP_SECRET"))
    .update(rawBody)
    .digest("hex");
  const received = Buffer.from(match[1], "hex");
  const expected = Buffer.from(expectedHex, "hex");

  if (!safeBufferEqual(received, expected)) {
    throw createHttpError("Invalid WhatsApp webhook signature", 401);
  }
  return true;
};

const fingerprintRawBody = (rawBody) => crypto.createHash("sha256").update(rawBody).digest("hex");

const webhookChanges = (payload) =>
  Array.isArray(payload?.entry)
    ? payload.entry.flatMap((entry) => (Array.isArray(entry?.changes) ? entry.changes : []))
    : [];

const identifyWebhookEvent = (payload, rawBody) => {
  const changes = webhookChanges(payload);
  const statuses = changes.flatMap((change) =>
    Array.isArray(change?.value?.statuses) ? change.value.statuses : []
  );
  const messages = changes.flatMap((change) =>
    Array.isArray(change?.value?.messages) ? change.value.messages : []
  );
  const fingerprint = fingerprintRawBody(rawBody);

  if (statuses.length === 1 && messages.length === 0) {
    const status = statuses[0];
    const parts = [status?.id, status?.status, status?.timestamp].map((value) =>
      String(value || "").trim()
    );
    const candidate = `status:${parts.join(":")}`;
    return {
      eventKey:
        parts.every(Boolean) && candidate.length <= 255 ? candidate : `status:${fingerprint}`,
      eventType: "status",
      metaMessageId: parts[0] || null
    };
  }

  if (messages.length === 1 && statuses.length === 0) {
    const metaMessageId = String(messages[0]?.id || "").trim();
    const candidate = `message:${metaMessageId}`;
    return {
      eventKey: metaMessageId && candidate.length <= 255 ? candidate : `message:${fingerprint}`,
      eventType: "message",
      metaMessageId: metaMessageId || null
    };
  }

  const eventType =
    statuses.length > 0 && messages.length > 0
      ? "mixed"
      : statuses.length > 0
        ? "status"
        : messages.length > 0
          ? "message"
          : "unknown";
  const metaMessageId = String(statuses[0]?.id || messages[0]?.id || "").trim() || null;
  return {
    eventKey: `${eventType}:${fingerprint}`,
    eventType,
    metaMessageId
  };
};

const recordVerifiedWebhook = async ({ payload, rawBody }) => {
  const identity = identifyWebhookEvent(payload, rawBody);
  const [event, created] = await WhatsAppWebhookEvent.findOrCreate({
    where: { event_key: identity.eventKey },
    defaults: {
      event_type: identity.eventType,
      meta_message_id: identity.metaMessageId,
      payload_json: rawBody.toString("utf8"),
      state: "received",
      signature_verified: true,
      received_at: new Date()
    }
  });
  return { event, created };
};

module.exports = {
  identifyWebhookEvent,
  recordVerifiedWebhook,
  safeBufferEqual,
  verifyChallengeToken,
  verifyMetaSignature
};
