const axios = require("axios");
const { Op } = require("sequelize");
const { getWhatsAppConfig, validateWhatsAppConfig } = require("../config/whatsapp");
const { FollowUp, Lead, Message, sequelize } = require("../models");
const { updateLeadScore } = require("./scoreService");

const normalizePhone = (phone) => String(phone || "").replace(/[^\d]/g, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableAxiosError = (error) => {
  const status = error?.response?.status;
  if (!status) {
    return true;
  }
  return status === 429 || status >= 500;
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
  const dueFollowups = await FollowUp.findAll({
    where: {
      status: "pending",
      cancelled: false,
      scheduled_date: {
        [Op.lte]: new Date()
      }
    },
    include: [
      {
        model: Lead,
        as: "lead",
        attributes: ["id", "name", "phone", "email", "status"]
      }
    ],
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
    const transaction = await sequelize.transaction();

    try {
      const latestFollowUp = await FollowUp.findOne({
        where: { id: followUp.id, status: "pending", cancelled: false },
        transaction,
        lock: transaction.LOCK.UPDATE
      });

      if (!latestFollowUp) {
        await transaction.rollback();
        continue;
      }

      const lead = await Lead.findByPk(latestFollowUp.lead_id, { transaction });
      if (!lead) {
        throw new Error("Lead not found for follow-up");
      }

      if (lead.status === "client" || latestFollowUp.cancelled) {
        await transaction.rollback();
        summary.skipped += 1;
        continue;
      }

      await sendWhatsAppMessage(lead.phone, lead.name, latestFollowUp.message);

      await Message.create(
        {
          lead_id: lead.id,
          message: latestFollowUp.message,
          type: "followup",
          status: "sent"
        },
        { transaction }
      );

      latestFollowUp.status = "completed";
      await latestFollowUp.save({ transaction });

      lead.last_contact_date = new Date();
      await lead.save({ transaction });
      await updateLeadScore(lead.id, { transaction });

      await transaction.commit();
      summary.processed += 1;
      summary.sent += 1;
    } catch (error) {
      await transaction.rollback();

      // Keep follow-up pending on failure and record attempt for observability.
      try {
        await Message.create({
          lead_id: followUp.lead_id,
          message: followUp.message,
          type: "followup",
          status: "failed"
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
          error.message
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
