const { Lead, Message, FollowUp, sequelize } = require("../models");
const { addContactToGoogle } = require("../services/googleService");
const { sendWhatsAppTemplate } = require("../services/whatsappService");
const { isWhatsAppSendingEnabled } = require("../config/whatsapp");
const { getWhatsAppConfig } = require("../config/whatsapp");
const { canSendWhatsApp } = require("../services/whatsappConsentService");
const { recordExplicitOptIn } = require("../services/whatsappConsentService");
const { generateFollowupSequence } = require("../services/sequenceService");
const { buildMessage } = require("../services/messageBuilder");
const { updateLeadScore } = require("../services/scoreService");
const { recordAudit } = require("../services/auditService");
const { getPagination, sendCollection } = require("../services/pagination");
const normalizeText = (value) => String(value || "").trim();

const createLead = async (req, res, next) => {
  let transaction;
  let transactionCommitted = false;

  try {
    const {
      name,
      first_name,
      last_name,
      gender,
      phone,
      email,
      source,
      status,
      whatsapp_opt_in,
      whatsapp_opt_in_source
    } = req.body;
    const firstName = normalizeText(first_name);
    const lastName = normalizeText(last_name);
    const fallbackName = normalizeText(name);
    const displayName = [firstName, lastName].filter(Boolean).join(" ") || fallbackName;
    const allowedGenders = ["male", "female", "unknown"];
    const normalizedGender = allowedGenders.includes(gender) ? gender : "unknown";

    if (!displayName || !phone) {
      return res.status(400).json({ message: "phone and at least one name field are required" });
    }

    transaction = await sequelize.transaction();

    const lead = await Lead.create(
      {
        name: displayName,
        first_name: firstName || null,
        last_name: lastName || null,
        gender: normalizedGender,
        phone,
        email,
        source,
        status: status || "new",
        whatsapp_opt_in: false,
        whatsapp_opt_in_at: null,
        whatsapp_opt_in_source: null
      },
      { transaction }
    );

    if (whatsapp_opt_in === true) {
      await recordExplicitOptIn({
        contact: lead,
        contactType: "lead",
        source: whatsapp_opt_in_source,
        eventAt: new Date(),
        createdBy: req.user.id,
        transaction
      });
    }

    // Marketing sequence:
    // J+1, J+3, J+7 follow-ups are generated immediately after lead creation.
    const sequenceRows = await generateFollowupSequence(lead, { transaction });
    lead.follow_up_date = sequenceRows[0].scheduled_date;
    await lead.save({ transaction });
    await updateLeadScore(lead.id, { transaction });
    await transaction.commit();
    transactionCommitted = true;

    // Example usage:
    // const { buildMessage } = require("../services/messageBuilder");
    // const message = buildMessage(lead, "initial");
    const initialMessageText = buildMessage(lead, "initial");
    if (canSendWhatsApp(lead, "marketing").allowed && isWhatsAppSendingEnabled()) {
      const templateParameter = firstName || displayName.split(/\s+/)[0];
      const { templateName, templateLanguage } = getWhatsAppConfig();
      const delivery = await Message.create({
        lead_id: lead.id,
        message: initialMessageText,
        type: "initial",
        status: "pending",
        template_name: templateName,
        template_language: templateLanguage,
        template_parameters_json: JSON.stringify([templateParameter]),
        delivery_evidence: "no_meta_request"
      });
      try {
        await delivery.update({ delivery_evidence: "meta_request_started" });
        const providerResponse = await sendWhatsAppTemplate(lead, templateParameter);
        const providerMessageId = providerResponse?.messages?.[0]?.id;
        if (!providerMessageId) {
          const error = new Error(
            "Meta accepted the request without returning a WhatsApp message id"
          );
          error.deliveryAmbiguous = true;
          throw error;
        }
        await delivery.update({
          status: "accepted",
          meta_status: "accepted",
          meta_message_id: providerMessageId,
          accepted_at: new Date(),
          delivery_evidence: "meta_accepted"
        });
      } catch (whatsAppError) {
        const ambiguous = Boolean(whatsAppError.deliveryAmbiguous);
        const noNetworkAttempt = Boolean(whatsAppError.noNetworkAttempt);
        await delivery.update({
          status: ambiguous ? "pending" : "failed",
          meta_status: ambiguous ? null : "failed",
          failed_at: ambiguous ? null : new Date(),
          delivery_evidence: ambiguous
            ? "ambiguous"
            : noNetworkAttempt
              ? "no_meta_request"
              : "meta_request_started",
          meta_error_message: String(whatsAppError.message || "WhatsApp delivery failed").slice(
            0,
            2000
          )
        });

        if (process.env.NODE_ENV !== "test") {
          console.error(
            "[WhatsApp Cloud API] Failed to send initial message for lead",
            lead.id,
            whatsAppError.message
          );
        }
      }
    }

    // Non-blocking: Google failure must never block lead creation.
    addContactToGoogle(displayName, phone, email).catch((googleError) => {
      if (process.env.NODE_ENV !== "test") {
        console.error(
          "[Google People API] Failed to create contact for lead",
          lead.id,
          googleError.message
        );
      }
    });

    await recordAudit(req, {
      action: "LEAD_CREATED",
      entity: "lead",
      entityId: lead.id,
      meta: { status: lead.status, source: lead.source }
    });

    return res.status(201).json(lead);
  } catch (error) {
    if (transaction && !transactionCommitted) {
      await transaction.rollback();
    }
    return next(error);
  }
};

const getLeads = async (req, res, next) => {
  try {
    const pagination = getPagination(req.query);
    const { rows, count } = await Lead.findAndCountAll({
      order: [["created_at", "DESC"]],
      limit: pagination.limit,
      offset: pagination.offset
    });
    return sendCollection(res, rows, count, pagination);
  } catch (error) {
    return next(error);
  }
};

const getLeadById = async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }
    return res.json(lead);
  } catch (error) {
    return next(error);
  }
};

const updateLeadStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ["new", "contacted", "client", "no_response"];

    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const lead = await Lead.findByPk(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    lead.status = status;
    lead.last_contact_date = new Date();
    await lead.save();
    await updateLeadScore(lead.id);
    await recordAudit(req, {
      action: "LEAD_STATUS_UPDATED",
      entity: "lead",
      entityId: lead.id,
      meta: { status: lead.status }
    });

    return res.json({
      message: "Lead status updated successfully",
      lead
    });
  } catch (error) {
    return next(error);
  }
};

const deleteLead = async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    await lead.destroy();
    await recordAudit(req, {
      action: "LEAD_DELETED",
      entity: "lead",
      entityId: lead.id
    });
    return res.json({ message: "Lead deleted successfully" });
  } catch (error) {
    return next(error);
  }
};

const cancelLeadSequence = async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    const [affectedRows] = await FollowUp.update(
      { cancelled: true },
      {
        where: {
          lead_id: lead.id,
          status: "pending",
          cancelled: false
        }
      }
    );

    await recordAudit(req, {
      action: "LEAD_SEQUENCE_CANCELLED",
      entity: "lead",
      entityId: lead.id,
      meta: { cancelled_followups: affectedRows }
    });

    return res.json({
      message: "Sequence cancelled successfully",
      cancelledFollowups: affectedRows
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createLead,
  getLeads,
  getLeadById,
  updateLeadStatus,
  deleteLead,
  cancelLeadSequence
};
