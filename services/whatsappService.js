const axios = require("axios");
const { Op } = require("sequelize");
const { getWhatsAppConfig, validateWhatsAppConfig } = require("../config/whatsapp");
const { FollowUp, Lead, Message, sequelize } = require("../models");
const { updateLeadScore } = require("./scoreService");

const normalizePhone = (phone) => String(phone || "").replace(/[^\d]/g, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableAxiosError = (error) => {
  const status = error?.response?.status;
  // A timeout/network break after writing the request is ambiguous: Meta may
  // already have accepted it, so an automatic retry could duplicate delivery.
  return Boolean(status && (status === 429 || status >= 500));
};

const sendWithRetry = async (requestConfig) => {
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
  throw lastError;
};

async function sendWhatsAppMessage(phone, name, messageText) {
  const sanitizedPhone = normalizePhone(phone);
  if (!sanitizedPhone || !messageText) {
    throw new Error("phone and messageText are required");
  }

  if (process.env.NODE_ENV === "test") {
    return { mock: true, to: sanitizedPhone, name };
  }

  validateWhatsAppConfig();
  const { token, endpoint } = getWhatsAppConfig();

  return sendWithRetry({
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
  });
}

async function processPendingFollowups() {
  const maxAttempts = Math.max(1, Number(process.env.WHATSAPP_FOLLOWUP_MAX_ATTEMPTS || 3));
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
    sent: 0,
    failed: 0,
    skipped: 0
  };

  for (const followUp of dueFollowups) {
    let providerAccepted = false;
    try {
      // Atomic claim: only one worker/process can change pending -> processing.
      const [claimed] = await FollowUp.update(
        {
          status: "processing",
          processing_started_at: new Date(),
          attempt_count: sequelize.literal("attempt_count + 1"),
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
        await latestFollowUp.update({ status: "completed", processing_started_at: null });
        summary.skipped += 1;
        continue;
      }

      const providerResponse = await sendWhatsAppMessage(
        lead.phone,
        lead.name,
        latestFollowUp.message
      );
      providerAccepted = true;
      const providerMessageId = providerResponse?.messages?.[0]?.id || null;

      await sequelize.transaction(async (transaction) => {
        await Message.findOrCreate({
          where: { followup_id: latestFollowUp.id },
          defaults: {
            lead_id: lead.id,
            followup_id: latestFollowUp.id,
            message: latestFollowUp.message,
            type: "followup",
            status: "sent"
          },
          transaction
        });
        await FollowUp.update(
          {
            status: "completed",
            processing_started_at: null,
            sent_at: new Date(),
            provider_message_id: providerMessageId,
            last_error: null
          },
          { where: { id: latestFollowUp.id, status: "processing" }, transaction }
        );
        await lead.update({ last_contact_date: new Date() }, { transaction });
        await updateLeadScore(lead.id, { transaction });
      });
      summary.processed += 1;
      summary.sent += 1;
    } catch (error) {
      const claimedFollowUp = await FollowUp.findByPk(followUp.id);
      const ambiguous = providerAccepted || Boolean(error.deliveryAmbiguous);
      const exhausted = Number(claimedFollowUp?.attempt_count || 0) >= maxAttempts;
      // Ambiguous deliveries stay processing and require reconciliation. A
      // confirmed rejection may be retried up to the configured attempt cap.
      if (claimedFollowUp?.status === "processing") {
        await claimedFollowUp.update({
          status: ambiguous ? "processing" : exhausted ? "failed" : "pending",
          processing_started_at: ambiguous ? claimedFollowUp.processing_started_at : null,
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
            status: "failed"
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
          ambiguous ? "(delivery state ambiguous; automatic retry disabled)" : ""
        );
      }
    }
  }

  return summary;
}

module.exports = {
  sendWhatsAppMessage,
  processPendingFollowups
};
