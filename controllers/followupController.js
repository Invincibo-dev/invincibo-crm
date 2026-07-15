const { FollowUp, Lead, sequelize } = require("../models");
const { processPendingFollowups } = require("../services/whatsappService");
const { recordAudit } = require("../services/auditService");
const { getPagination, sendCollection } = require("../services/pagination");
const {
  listReviewFollowUps,
  recoverStuckBatch,
  reviewFollowUp
} = require("../services/followupRecoveryService");

const createFollowUp = async (req, res, next) => {
  const transaction = await sequelize.transaction();

  try {
    const { lead_id, scheduled_date, message, sequence_step } = req.body;

    if (!lead_id || !scheduled_date || !message) {
      await transaction.rollback();
      return res.status(400).json({ message: "lead_id, scheduled_date and message are required" });
    }

    const lead = await Lead.findByPk(lead_id, { transaction });
    if (!lead) {
      await transaction.rollback();
      return res.status(404).json({ message: "Lead not found" });
    }

    const followUp = await FollowUp.create(
      {
        lead_id,
        scheduled_date,
        message,
        sequence_step: Number.isInteger(sequence_step) ? sequence_step : 0,
        cancelled: false,
        status: "pending"
      },
      { transaction }
    );

    lead.follow_up_date = scheduled_date;
    await lead.save({ transaction });

    await transaction.commit();
    await recordAudit(req, {
      action: "FOLLOWUP_CREATED",
      entity: "followup",
      entityId: followUp.id,
      meta: { lead_id: lead.id, sequence_step: followUp.sequence_step }
    });

    return res.status(201).json({
      message: "Follow-up created successfully",
      followUp
    });
  } catch (error) {
    await transaction.rollback();
    return next(error);
  }
};

const processFollowups = async (req, res, next) => {
  try {
    const result = await processPendingFollowups();
    await recordAudit(req, {
      action: "FOLLOWUPS_PROCESSED",
      entity: "followup",
      meta: result
    });
    return res.json({
      message: "Pending follow-ups processed",
      result
    });
  } catch (error) {
    return next(error);
  }
};

const getPendingFollowUps = async (req, res, next) => {
  try {
    const pagination = getPagination(req.query);
    const { rows, count } = await FollowUp.findAndCountAll({
      where: { status: "pending", cancelled: false },
      include: [
        {
          model: Lead,
          as: "lead",
          attributes: ["id", "name", "phone", "email", "status"]
        }
      ],
      order: [["scheduled_date", "ASC"]],
      limit: pagination.limit,
      offset: pagination.offset,
      distinct: true
    });

    return sendCollection(res, rows, count, pagination);
  } catch (error) {
    return next(error);
  }
};

const getReviewFollowUps = async (req, res, next) => {
  try {
    const pagination = getPagination(req.query);
    const result = await listReviewFollowUps(pagination);
    return res.json({
      data: result.rows,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.count,
        total_pages: Math.ceil(result.count / result.limit),
        has_next: result.page * result.limit < result.count,
        has_previous: result.page > 1
      }
    });
  } catch (error) {
    return next(error);
  }
};

const runFollowUpRecovery = async (req, res, next) => {
  try {
    const result = await recoverStuckBatch({
      dryRun: req.body?.dry_run === true,
      limit: req.body?.limit
    });
    return res.json({ dry_run: req.body?.dry_run === true, result });
  } catch (error) {
    return next(error);
  }
};

const reviewFollowUpDecision = async (req, res, next) => {
  try {
    const result = await reviewFollowUp(
      req.params.id,
      req.body?.decision,
      req.user,
      req.body?.note
    );
    return res.json({
      followUp: result.followUp,
      changed: result.changed,
      idempotent: result.idempotent
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createFollowUp,
  getReviewFollowUps,
  getPendingFollowUps,
  processFollowups,
  reviewFollowUpDecision,
  runFollowUpRecovery
};
