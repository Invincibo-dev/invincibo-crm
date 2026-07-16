const axios = require("axios");
const crypto = require("crypto");
const { Op } = require("sequelize");
const {
  getWhatsAppConfig,
  isWhatsAppSendingEnabled,
  validateWhatsAppConfig
} = require("../config/whatsapp");
const { FollowUp, Lead, Message, sequelize } = require("../models");
const { canSendWhatsApp } = require("./whatsappConsentService");
const { normalizeWhatsAppPhone } = require("./whatsappPhoneService");
const { getFollowUpRecoveryConfig } = require("../config/followupRecovery");
const { updateLeadScore } = require("./scoreService");

const normalizePhone = normalizeWhatsAppPhone;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const redactGraphDiagnosticText = (value, maxLength = 1000) => {
  if (value === undefined || value === null) return null;
  return String(value)
    .replace(/access_token=[^&\s]+/gi, "access_token=[REDACTED]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/\bEAA[A-Za-z0-9._-]+\b/g, "[REDACTED_TOKEN]")
    .replace(/\b\d{7,20}\b/g, (digits) => `${digits.slice(0, 3)}******${digits.slice(-2)}`)
    .slice(0, maxLength);
};

const extractWhatsAppGraphError = (error, sendPath = "unknown") => {
  const metaError = error?.response?.data?.error || {};
  const allowedPaths = new Set(["template", "freeform"]);
  return {
    timestamp: new Date().toISOString(),
    send_path: allowedPaths.has(sendPath) ? sendPath : "unknown",
    http_status: Number(error?.response?.status) || null,
    meta_error_type: redactGraphDiagnosticText(metaError.type, 100),
    meta_error_code:
      metaError.code === undefined || metaError.code === null ? null : String(metaError.code),
    meta_error_subcode:
      metaError.error_subcode === undefined || metaError.error_subcode === null
        ? null
        : String(metaError.error_subcode),
    message: redactGraphDiagnosticText(metaError.message || error?.message, 1000),
    error_data_details: redactGraphDiagnosticText(metaError.error_data?.details, 1000),
    fbtrace_id: redactGraphDiagnosticText(metaError.fbtrace_id, 255)
  };
};

const assertSendingEnabled = () => {
  if (!isWhatsAppSendingEnabled()) {
    const error = new Error("WhatsApp sending is disabled by WHATSAPP_SEND_ENABLED");
    error.code = "WHATSAPP_SEND_DISABLED";
    error.noNetworkAttempt = true;
    throw error;
  }
};

const buildTemplatePayload = ({ phone, firstName, templateName, templateLanguage }) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: normalizePhone(phone),
  type: "template",
  template: {
    name: templateName,
    language: {
      code: templateLanguage
    },
    components: [
      {
        type: "body",
        parameters: [{ type: "text", text: String(firstName || "Client").trim() || "Client" }]
      }
    ]
  }
});

const isRetryableAxiosError = (error) => {
  const status = error?.response?.status;
  // A timeout/network break after writing the request is ambiguous: Meta may
  // already have accepted it, so an automatic retry could duplicate delivery.
  return Boolean(status && (status === 429 || status >= 500));
};

const sendWithRetry = async (requestConfig, sendPath) => {
  const maxRetries = Number(process.env.WHATSAPP_MAX_RETRIES || 2);
  const backoffMs = Number(process.env.WHATSAPP_RETRY_BACKOFF_MS || 1200);

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await axios(requestConfig);
      return response.data;
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isRetryableAxiosError(error)) {
        break;
      }
      await sleep(backoffMs * (attempt + 1));
    }
  }

  if (lastError && !lastError.response) {
    lastError.deliveryAmbiguous = true;
  }
  if (lastError) {
    lastError.whatsappDiagnostic = extractWhatsAppGraphError(lastError, sendPath);
    if (process.env.NODE_ENV !== "test") {
      console.error(
        "[WhatsApp Cloud API] Graph request failed",
        JSON.stringify(lastError.whatsappDiagnostic)
      );
    }
  }
  throw lastError;
};

async function sendWhatsAppMessage(contact, name, messageText, messageCategory = "marketing") {
  const policy = canSendWhatsApp(contact, messageCategory);
  if (!policy.allowed) return { success: false, skipped: true, status: "skipped_opt_out" };
  const sanitizedPhone = normalizePhone(contact.phone);
  if (!sanitizedPhone || !messageText) {
    throw new Error("phone and messageText are required");
  }

  assertSendingEnabled();
  if (process.env.NODE_ENV === "test") {
    return {
      mock: true,
      to: sanitizedPhone,
      name,
      messages: [{ id: `wamid.test.${crypto.randomUUID()}` }]
    };
  }

  const { token, endpoint, allowFreeformMessages } = validateWhatsAppConfig();
  if (!allowFreeformMessages) {
    const error = new Error(
      "Free-form WhatsApp messages are disabled; use an approved template or an open service window"
    );
    error.noNetworkAttempt = true;
    throw error;
  }

  return sendWithRetry(
    {
      method: "post",
      url: endpoint,
      data: {
        messaging_product: "whatsapp",
        to: sanitizedPhone,
        type: "text",
        text: {
          body: messageText
        }
      },
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      timeout: 10000
    },
    "freeform"
  );
}

async function sendWhatsAppTemplate(contact, firstName, messageCategory = "marketing") {
  const policy = canSendWhatsApp(contact, messageCategory);
  if (!policy.allowed) return { success: false, skipped: true, status: "skipped_opt_out" };
  const sanitizedPhone = normalizePhone(contact.phone);
  if (!sanitizedPhone) {
    throw new Error("phone is required");
  }

  assertSendingEnabled();
  if (process.env.NODE_ENV === "test") {
    return {
      mock: true,
      to: sanitizedPhone,
      firstName,
      messages: [{ id: `wamid.test.${crypto.randomUUID()}` }]
    };
  }

  const { token, endpoint, templateName, templateLanguage } = validateWhatsAppConfig({
    requireTemplate: true
  });

  return sendWithRetry(
    {
      method: "post",
      url: endpoint,
      data: buildTemplatePayload({
        phone: sanitizedPhone,
        firstName,
        templateName,
        templateLanguage
      }),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      timeout: 10000
    },
    "template"
  );
}

async function processPendingFollowups() {
  if (!isWhatsAppSendingEnabled()) {
    return {
      total: 0,
      processed: 0,
      accepted: 0,
      failed: 0,
      skipped: 0,
      skipped_opt_out: 0,
      disabled: true
    };
  }

  const { maxAttempts } = getFollowUpRecoveryConfig();
  const dueFollowups = await FollowUp.findAll({
    where: {
      status: "pending",
      cancelled: false,
      scheduled_date: {
        [Op.lte]: new Date()
      }
    },
    attributes: ["id"],
    order: [["scheduled_date", "ASC"]]
  });

  const summary = {
    total: dueFollowups.length,
    processed: 0,
    accepted: 0,
    failed: 0,
    skipped: 0,
    skipped_opt_out: 0
  };

  for (const followUp of dueFollowups) {
    let providerAccepted = false;
    let acceptedProviderMessageId = null;
    let providerAcceptedAt = null;
    try {
      // Atomic claim: only one worker/process can change pending -> processing.
      const [claimed] = await FollowUp.update(
        {
          status: "processing",
          processing_started_at: new Date(),
          attempt_count: sequelize.literal("attempt_count + 1"),
          delivery_evidence: "no_meta_request",
          updated_at: new Date(),
          last_error: null
        },
        { where: { id: followUp.id, status: "pending", cancelled: false } }
      );
      if (claimed !== 1) {
        continue;
      }

      const latestFollowUp = await FollowUp.findByPk(followUp.id);
      const lead = await Lead.findByPk(latestFollowUp.lead_id);
      if (!lead) {
        throw new Error("Lead not found for follow-up");
      }

      if (lead.status === "client" || latestFollowUp.cancelled) {
        await latestFollowUp.update({
          status: "pending",
          cancelled: true,
          processing_started_at: null,
          attempt_count: Math.max(0, Number(latestFollowUp.attempt_count || 0) - 1),
          delivery_evidence: null,
          review_reason: lead.status === "client" ? "lead_is_client" : "cancelled_before_send"
        });
        summary.skipped += 1;
        continue;
      }

      const policy = canSendWhatsApp(lead, "marketing");
      if (!policy.allowed) {
        await latestFollowUp.update({
          status: "needs_review",
          cancelled: true,
          processing_started_at: null,
          review_reason: "skipped_opt_out",
          last_error: policy.reason
        });
        summary.skipped += 1;
        summary.skipped_opt_out += 1;
        continue;
      }

      // This durable evidence must be written before any network request.
      await latestFollowUp.update({
        delivery_evidence: "meta_request_started",
        updated_at: new Date()
      });
      const providerResponse = await sendWhatsAppTemplate(
        lead,
        lead.first_name || String(lead.name || "").split(/\s+/)[0]
      );
      providerAccepted = true;
      const providerMessageId = providerResponse?.messages?.[0]?.id || null;
      acceptedProviderMessageId = providerMessageId;
      if (!providerMessageId) {
        throw new Error("Meta accepted the request without returning a WhatsApp message id");
      }
      const acceptedAt = new Date();
      providerAcceptedAt = acceptedAt;
      const { templateName, templateLanguage } = getWhatsAppConfig();

      await sequelize.transaction(async (transaction) => {
        const [delivery] = await Message.findOrCreate({
          where: { followup_id: latestFollowUp.id },
          defaults: {
            lead_id: lead.id,
            followup_id: latestFollowUp.id,
            message: latestFollowUp.message,
            type: "followup",
            status: "accepted"
          },
          transaction
        });
        await delivery.update(
          {
            status: "accepted",
            meta_status: "accepted",
            meta_message_id: providerMessageId,
            template_name: templateName,
            template_language: templateLanguage,
            template_parameters_json: JSON.stringify([
              lead.first_name || String(lead.name || "").split(/\s+/)[0] || "Client"
            ]),
            accepted_at: acceptedAt,
            meta_error_code: null,
            meta_error_message: null
          },
          { transaction }
        );
        await FollowUp.update(
          {
            status: "processing",
            provider_message_id: providerMessageId,
            meta_status: "accepted",
            accepted_at: acceptedAt,
            delivery_evidence: "meta_accepted",
            meta_error_code: null,
            meta_error_message: null,
            last_error: null
          },
          { where: { id: latestFollowUp.id, status: "processing" }, transaction }
        );
        await lead.update({ last_contact_date: acceptedAt }, { transaction });
        await updateLeadScore(lead.id, { transaction });
      });
      summary.processed += 1;
      summary.accepted += 1;
    } catch (error) {
      const claimedFollowUp = await FollowUp.findByPk(followUp.id);
      const ambiguous = providerAccepted || Boolean(error.deliveryAmbiguous);
      const noNetworkAttempt = Boolean(error.noNetworkAttempt);
      const exhausted = Number(claimedFollowUp?.attempt_count || 0) >= maxAttempts;
      // Ambiguous deliveries require manual review. A confirmed rejection may
      // be retried up to the configured attempt cap.
      if (claimedFollowUp?.status === "processing") {
        await claimedFollowUp.update({
          status: ambiguous ? "needs_review" : exhausted ? "failed" : "pending",
          processing_started_at: null,
          provider_message_id:
            acceptedProviderMessageId || claimedFollowUp.provider_message_id || null,
          meta_status: acceptedProviderMessageId ? "accepted" : claimedFollowUp.meta_status,
          accepted_at: providerAcceptedAt || claimedFollowUp.accepted_at,
          review_reason: ambiguous
            ? "Meta delivery may have been accepted but local finalization failed"
            : null,
          delivery_evidence: ambiguous
            ? acceptedProviderMessageId
              ? "meta_accepted"
              : "ambiguous"
            : noNetworkAttempt
              ? "no_meta_request"
              : "meta_request_started",
          last_error: String(error.message || "WhatsApp delivery failed").slice(0, 2000)
        });
      }

      try {
        await Message.findOrCreate({
          where: { followup_id: claimedFollowUp.id },
          defaults: {
            lead_id: claimedFollowUp.lead_id,
            followup_id: claimedFollowUp.id,
            message: claimedFollowUp.message,
            type: "followup",
            status: acceptedProviderMessageId ? "accepted" : "failed",
            meta_status: acceptedProviderMessageId ? "accepted" : "failed",
            meta_message_id: acceptedProviderMessageId,
            accepted_at: providerAcceptedAt,
            failed_at: acceptedProviderMessageId ? null : new Date(),
            delivery_evidence: acceptedProviderMessageId
              ? "meta_accepted"
              : noNetworkAttempt
                ? "no_meta_request"
                : "meta_request_started"
          }
        });
      } catch (_logError) {
        // No-op: secondary logging failure should not break processor loop.
      }

      summary.processed += 1;
      summary.failed += 1;

      if (process.env.NODE_ENV !== "test") {
        console.error(
          "[Followup Processor] Failed for follow-up",
          followUp.id,
          error.message,
          ambiguous ? "(delivery state ambiguous; manual review required)" : ""
        );
      }
    }
  }

  return summary;
}

module.exports = {
  buildTemplatePayload,
  extractWhatsAppGraphError,
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
  processPendingFollowups
};
