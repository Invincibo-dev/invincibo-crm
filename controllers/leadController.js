const { Lead, Message, FollowUp, sequelize } = require("../models");
const { addContactToGoogle } = require("../services/googleService");
const { sendWhatsAppMessage } = require("../services/whatsappService");
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
    const { name, first_name, last_name, gender, phone, email, source, status } = req.body;
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
        status: status || "new"
      },
      { transaction }
    );

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
    try {
      await sendWhatsAppMessage(phone, displayName, initialMessageText);
      await Message.create({
        lead_id: lead.id,
        message: initialMessageText,
        type: "initial",
        status: "sent"
      });
    } catch (whatsAppError) {
      await Message.create({
        lead_id: lead.id,
        message: initialMessageText,
        type: "initial",
        status: "failed"
      });

      if (process.env.NODE_ENV !== "test") {
        console.error(
          "[WhatsApp Cloud API] Failed to send initial message for lead",
          lead.id,
          whatsAppError.message
        );
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
