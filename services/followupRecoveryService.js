const { Op } = require("sequelize");
const { getFollowUpRecoveryConfig, positiveInteger } = require("../config/followupRecovery");
const { AuditLog, FollowUp, Lead, Message, sequelize } = require("../models");
const { canSendWhatsApp } = require("./whatsappConsentService");

const RECOVERY_SUMMARY = Object.freeze({
  scanned: 0,
  completed: 0,
  failed: 0,
  needs_review: 0,
  returned_to_pending: 0,
  opted_out: 0,
  ignored: 0,
  errors: 0
});
const MANUAL_DECISIONS = new Set(["mark_completed", "mark_failed", "return_to_pending", "cancel"]);
const recoveryInFlight = new Set();

const createHttpError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const recoveryCutoff = (now, timeoutMinutes) =>
  new Date(new Date(now).getTime() - timeoutMinutes * 60 * 1000);

const stuckWhere = ({ cutoff, afterId = null }) => ({
  status: "processing",
  ...(afterId ? { id: { [Op.gt]: afterId } } : {}),
  [Op.or]: [
    { processing_started_at: { [Op.lte]: cutoff } },
    {
      processing_started_at: null,
      updated_at: { [Op.lte]: cutoff }
    }
  ]
});

const findStuckFollowUps = async (options = {}) => {
  const config = getFollowUpRecoveryConfig();
  const now = options.now || new Date();
  const timeoutMinutes = positiveInteger(options.timeoutMinutes, config.processingTimeoutMinutes);
  const limit = Math.min(positiveInteger(options.limit, config.batchSize), 250);
  const page = positiveInteger(options.page, 1);
  const where = stuckWhere({
    cutoff: recoveryCutoff(now, timeoutMinutes),
    afterId: options.afterId || null
  });
  const query = {
    where,
    order: [["id", "ASC"]],
    limit,
    transaction: options.transaction
  };
  if (!options.afterId) query.offset = (page - 1) * limit;
  const { rows, count } = await FollowUp.findAndCountAll(query);
  return { rows, count, page, limit, timeoutMinutes };
};

const findDeliveryMessage = async (followUp, transaction) => {
  const conditions = [{ followup_id: followUp.id }];
  if (followUp.provider_message_id) {
    conditions.push({ meta_message_id: followUp.provider_message_id });
  }
  return Message.findOne({
    where: { [Op.or]: conditions },
    order: [["id", "DESC"]],
    transaction,
    lock: transaction?.LOCK.UPDATE
  });
};

const terminalMetaStatus = (followUp, message) =>
  message?.meta_status ||
  (["delivered", "read", "failed"].includes(message?.status) ? message.status : null) ||
  followUp.meta_status;

const classifyStuckFollowUp = (followUp, { message = null, lead = null, maxAttempts } = {}) => {
  if (followUp.status !== "processing") return { action: "ignored", reason: "state_changed" };

  const metaStatus = terminalMetaStatus(followUp, message);
  if (metaStatus === "delivered" || metaStatus === "read") {
    return { action: "completed", reason: "terminal_meta_status_present", metaStatus };
  }
  if (metaStatus === "failed") {
    return { action: "failed", reason: "terminal_meta_status_present", metaStatus };
  }
  if (!canSendWhatsApp(lead, "marketing").allowed) {
    return { action: "needs_review", reason: "contact_opted_out", optedOut: true };
  }
  if (Number(followUp.attempt_count || 0) >= maxAttempts) {
    return { action: "needs_review", reason: "maximum_attempts_reached" };
  }
  if (followUp.provider_message_id || message?.meta_message_id) {
    return { action: "needs_review", reason: "meta_status_missing_after_timeout" };
  }
  if (followUp.delivery_evidence === "no_meta_request") {
    return { action: "returned_to_pending", reason: "confirmed_no_meta_request" };
  }
  return { action: "needs_review", reason: "ambiguous_delivery_result" };
};

const auditTransition = async (
  { followUp, oldStatus, newStatus, reason, source, actorId = null, note = null },
  transaction
) =>
  AuditLog.create(
    {
      user_id: actorId,
      action: source === "manual_review" ? "FOLLOWUP_MANUAL_REVIEW" : "FOLLOWUP_RECOVERED",
      entity: "followup",
      entity_id: followUp.id,
      ip: null,
      meta_json: JSON.stringify({
        old_status: oldStatus,
        new_status: newStatus,
        reason,
        source,
        note,
        wamid: followUp.provider_message_id || null
      })
    },
    { transaction }
  );

const applyRecovery = async (followUp, classification, transaction) => {
  const oldStatus = followUp.status;
  if (classification.action === "completed") {
    followUp.status = "completed";
    followUp.processing_started_at = null;
  } else if (classification.action === "failed") {
    followUp.status = "failed";
    followUp.processing_started_at = null;
  } else if (classification.action === "needs_review") {
    followUp.status = "needs_review";
    followUp.review_reason = classification.reason;
    followUp.processing_started_at = null;
    if (classification.optedOut) followUp.cancelled = true;
  } else if (classification.action === "returned_to_pending") {
    followUp.status = "pending";
    followUp.processing_started_at = null;
    followUp.delivery_evidence = null;
    followUp.attempt_count = Math.max(0, Number(followUp.attempt_count || 0) - 1);
    followUp.review_reason = null;
  } else {
    return false;
  }
  followUp.recovery_source = "automatic_recovery";
  await followUp.save({ transaction });
  await auditTransition(
    {
      followUp,
      oldStatus,
      newStatus: followUp.status,
      reason: classification.reason,
      source: "automatic_recovery"
    },
    transaction
  );
  return true;
};

const recoverStuckFollowUp = async (followUpId, options = {}) => {
  const id = positiveInteger(followUpId, 0);
  if (!id) throw createHttpError("Invalid follow-up id", 400);
  if (recoveryInFlight.has(id)) return { action: "ignored", reason: "recovery_in_progress" };
  recoveryInFlight.add(id);

  try {
    const execute = () =>
      sequelize.transaction(async (transaction) => {
        const config = getFollowUpRecoveryConfig();
        const followUp = await FollowUp.findByPk(id, {
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        if (!followUp || followUp.status !== "processing") {
          return { action: "ignored", reason: followUp ? "state_changed" : "not_found" };
        }
        const referenceDate = followUp.processing_started_at || followUp.updated_at;
        const cutoff = recoveryCutoff(
          options.now || new Date(),
          positiveInteger(options.timeoutMinutes, config.processingTimeoutMinutes)
        );
        if (!referenceDate || new Date(referenceDate) > cutoff) {
          return { action: "ignored", reason: "processing_not_timed_out" };
        }

        const [lead, message] = await Promise.all([
          Lead.findByPk(followUp.lead_id, { transaction, lock: transaction.LOCK.UPDATE }),
          findDeliveryMessage(followUp, transaction)
        ]);
        const classification = classifyStuckFollowUp(followUp, {
          lead,
          message,
          maxAttempts: positiveInteger(options.maxAttempts, config.maxAttempts)
        });
        if (!options.dryRun) await applyRecovery(followUp, classification, transaction);
        return { ...classification, followUpId: followUp.id, dryRun: Boolean(options.dryRun) };
      });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await execute();
      } catch (error) {
        const transientSqlite =
          sequelize.getDialect() === "sqlite" &&
          /SQLITE_BUSY|cannot start a transaction|cannot commit - no transaction is active/i.test(
            String(error.message || "")
          );
        if (!transientSqlite || attempt === 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    return { action: "ignored", reason: "state_changed" };
  } finally {
    recoveryInFlight.delete(id);
  }
};

const recoverStuckBatch = async (options = {}) => {
  const config = getFollowUpRecoveryConfig();
  const requestedLimit = Math.min(positiveInteger(options.limit, config.batchSize), 250);
  const chunkSize = Math.min(config.batchSize, requestedLimit);
  const summary = { ...RECOVERY_SUMMARY };
  let afterId = 0;

  while (summary.scanned < requestedLimit) {
    const remaining = requestedLimit - summary.scanned;
    const { rows } = await findStuckFollowUps({
      ...options,
      afterId,
      limit: Math.min(chunkSize, remaining)
    });
    if (rows.length === 0) break;

    for (const candidate of rows) {
      afterId = candidate.id;
      summary.scanned += 1;
      try {
        const result = await recoverStuckFollowUp(candidate.id, options);
        if (result.action === "completed") summary.completed += 1;
        else if (result.action === "failed") summary.failed += 1;
        else if (result.action === "needs_review") {
          summary.needs_review += 1;
          if (result.optedOut) summary.opted_out += 1;
        } else if (result.action === "returned_to_pending") summary.returned_to_pending += 1;
        else summary.ignored += 1;
      } catch (_error) {
        summary.errors += 1;
      }
    }
    if (rows.length < Math.min(chunkSize, remaining)) break;
  }
  return summary;
};

const returnToPendingAllowed = ({ followUp, lead, message, maxAttempts }) => {
  if (followUp.provider_message_id) return false;
  if (followUp.delivery_evidence !== "no_meta_request") return false;
  if (!canSendWhatsApp(lead, "marketing").allowed) return false;
  if (["delivered", "read"].includes(terminalMetaStatus(followUp, message))) return false;
  return Number(followUp.attempt_count || 0) < maxAttempts;
};

const systemRecommendation = (followUp, allowed) => {
  if (allowed) return "return_to_pending_available";
  if (followUp.review_reason === "contact_opted_out") return "keep_cancelled";
  if (followUp.review_reason === "maximum_attempts_reached") return "mark_failed_or_cancel";
  if (followUp.provider_message_id) return "wait_for_webhook_or_verify_in_meta";
  return "manual_verification_required";
};

const listReviewFollowUps = async ({ page = 1, limit = 50 } = {}) => {
  const config = getFollowUpRecoveryConfig();
  const safePage = positiveInteger(page, 1);
  const safeLimit = Math.min(positiveInteger(limit, 50), 250);
  const { rows, count } = await FollowUp.findAndCountAll({
    where: { status: "needs_review" },
    include: [
      { model: Lead, as: "lead" },
      { model: Message, as: "delivery", required: false }
    ],
    order: [["updated_at", "DESC"]],
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
    distinct: true
  });
  return {
    rows: rows.map((row) => {
      const json = row.toJSON();
      const allowed = returnToPendingAllowed({
        followUp: row,
        lead: row.lead,
        message: row.delivery,
        maxAttempts: config.maxAttempts
      });
      return {
        ...json,
        consent: canSendWhatsApp(row.lead, "marketing"),
        return_to_pending_allowed: allowed,
        system_recommendation: systemRecommendation(row, allowed)
      };
    }),
    count,
    page: safePage,
    limit: safeLimit
  };
};

const reviewFollowUp = async (followUpId, decision, actor, note) => {
  const id = positiveInteger(followUpId, 0);
  const normalizedDecision = String(decision || "").trim();
  const normalizedNote = String(note || "").trim();
  if (!id) throw createHttpError("Invalid follow-up id", 400);
  if (!MANUAL_DECISIONS.has(normalizedDecision))
    throw createHttpError("Invalid review decision", 400);
  if (!normalizedNote) throw createHttpError("A review note is required", 400);
  if (!actor?.id || actor.role !== "admin") throw createHttpError("Admin review is required", 403);

  return sequelize.transaction(async (transaction) => {
    const config = getFollowUpRecoveryConfig();
    const followUp = await FollowUp.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!followUp) throw createHttpError("Follow-up not found", 404);

    const targetStatus =
      normalizedDecision === "mark_completed"
        ? "completed"
        : normalizedDecision === "return_to_pending"
          ? "pending"
          : "failed";
    if (followUp.status === targetStatus && followUp.recovery_source === "manual_review") {
      return { followUp, changed: false, idempotent: true };
    }
    if (["completed", "failed"].includes(followUp.status)) {
      throw createHttpError("A terminal follow-up cannot be changed", 409);
    }
    if (followUp.status !== "needs_review") {
      throw createHttpError("Follow-up is not awaiting review", 409);
    }

    const [lead, message] = await Promise.all([
      Lead.findByPk(followUp.lead_id, { transaction, lock: transaction.LOCK.UPDATE }),
      findDeliveryMessage(followUp, transaction)
    ]);
    if (
      normalizedDecision === "return_to_pending" &&
      !returnToPendingAllowed({
        followUp,
        lead,
        message,
        maxAttempts: config.maxAttempts
      })
    ) {
      throw createHttpError("Return to pending is not safe for this follow-up", 409);
    }

    const oldStatus = followUp.status;
    followUp.status = targetStatus;
    followUp.cancelled = normalizedDecision === "cancel";
    followUp.processing_started_at = null;
    followUp.reviewed_at = new Date();
    followUp.reviewed_by = actor.id;
    followUp.review_note = normalizedNote;
    followUp.recovery_source = "manual_review";
    if (normalizedDecision === "return_to_pending") {
      followUp.attempt_count = Math.max(0, Number(followUp.attempt_count || 0) - 1);
      followUp.delivery_evidence = null;
    }
    await followUp.save({ transaction });
    await auditTransition(
      {
        followUp,
        oldStatus,
        newStatus: followUp.status,
        reason: normalizedDecision,
        source: "manual_review",
        actorId: actor.id,
        note: normalizedNote
      },
      transaction
    );
    return { followUp, changed: true, idempotent: false };
  });
};

module.exports = {
  MANUAL_DECISIONS,
  classifyStuckFollowUp,
  findStuckFollowUps,
  listReviewFollowUps,
  recoverStuckBatch,
  recoverStuckFollowUp,
  reviewFollowUp
};
