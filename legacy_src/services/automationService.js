const { Op } = require("sequelize");
const { Student, StudentAction, sequelize } = require("../models");
const activationService = require("./activationService");
const whatsappService = require("./whatsappService");
const trackingService = require("./trackingService");
const { AppError } = require("./errors");

const DAY_MS = 24 * 60 * 60 * 1000;
const WHATSAPP_COOLDOWN_HOURS = Number(process.env.WHATSAPP_COOLDOWN_HOURS || 6);
const WHATSAPP_COOLDOWN_MS = WHATSAPP_COOLDOWN_HOURS * 60 * 60 * 1000;

const normalize = (value) => String(value || "").trim();

const getStatusValues = () => Student.getAttributes().status?.values || [];

const ensureStatusSupported = (status) => {
  if (!getStatusValues().includes(status)) {
    throw new AppError(`Student status \"${status}\" is not supported by model enum`, 500);
  }
};

const resolveSituation = (student, now = new Date()) => {
  const status = normalize(student?.status).toLowerCase();
  const lastActionAt = student?.last_action_at ? new Date(student.last_action_at) : null;
  const ageMs = lastActionAt ? now.getTime() - lastActionAt.getTime() : Number.POSITIVE_INFINITY;

  if (status === "at_risk") {
    return ageMs > DAY_MS ? "at_risk_strong" : "at_risk";
  }
  if (status === "blocked") {
    return ageMs > 2 * DAY_MS ? "blocked_escalation" : "blocked";
  }
  if (status === "inactive") {
    return "inactive";
  }
  if (status === "onboarding" && ageMs > DAY_MS) {
    return "onboarding_stuck";
  }

  return null;
};

const detectActionTypeForSituation = (situation) => {
  switch (situation) {
    case "at_risk":
    case "at_risk_strong":
    case "inactive":
      return "message";
    case "onboarding_stuck":
      return "onboarding";
    case "blocked":
    case "blocked_escalation":
      return "support";
    default:
      return "support";
  }
};

const detectTrackingTypeForSituation = (situation) => {
  switch (situation) {
    case "onboarding_stuck":
      return "onboarding";
    case "inactive":
      return "payment";
    default:
      return "activation";
  }
};

const getRequiredActionType = (preferred) => {
  const allowed = StudentAction.getAttributes().type?.values || [];
  if (allowed.includes(preferred)) {
    return preferred;
  }
  if (allowed.includes("support")) {
    return "support";
  }
  throw new AppError("StudentAction type enum is missing required values", 500);
};

const generateWhatsAppMessage = async (student, situation) => {
  if (!student?.id) {
    throw new AppError("Student is required", 400);
  }

  const flow = await activationService.getStudentStatusFlow(student.id);
  const studentName = flow.student?.name || student.name || "etudiant";
  const nextStep = flow.next_recommended_step || "manual_review";

  switch (situation) {
    case "at_risk":
      return `Bonjour ${studentName}, ton activation est en pause. Fais l'etape ${nextStep} maintenant: [lien]`;
    case "at_risk_strong":
      return `Bonjour ${studentName}, rappel urgent: termine l'etape ${nextStep} maintenant: [lien]`;
    case "blocked":
      return `Bonjour ${studentName}, ton dossier est bloque. Assistance support immediate ici: [lien]`;
    case "blocked_escalation":
      return `Bonjour ${studentName}, support prioritaire active. Reprends maintenant ici: [lien]`;
    case "inactive":
      return `Bonjour ${studentName}, ton compte est inactif. Relance ton activation ici: [lien]`;
    case "onboarding_stuck":
      return `Bonjour ${studentName}, onboarding en attente. Continue ton etape maintenant: [lien]`;
    default:
      return `Bonjour ${studentName}, continue ton activation maintenant: [lien]`;
  }
};

const findRecentSameMessage = async ({ studentId, actionType, message, now }) => {
  const minDate = new Date(now.getTime() - WHATSAPP_COOLDOWN_MS);

  return StudentAction.findOne({
    where: {
      student_id: studentId,
      type: actionType,
      created_at: { [Op.gte]: minDate },
      content: { [Op.like]: `%${message}%` }
    },
    order: [["created_at", "DESC"]]
  });
};

const findRecentWhatsappAttempt = async ({ studentId, actionType, now }) => {
  const minDate = new Date(now.getTime() - WHATSAPP_COOLDOWN_MS);

  return StudentAction.findOne({
    where: {
      student_id: studentId,
      type: actionType,
      created_at: { [Op.gte]: minDate },
      content: {
        [Op.or]: [{ [Op.like]: "[wa:sent]%" }, { [Op.like]: "[wa:failed]%" }, { [Op.like]: "[wa:skipped]%" }]
      }
    },
    order: [["created_at", "DESC"]]
  });
};

const logRecoveryAction = async ({ studentId, situation, message, sendResult, reason = null, transaction }) => {
  const preferredType = detectActionTypeForSituation(situation);
  const type = getRequiredActionType(preferredType);

  const prefix = sendResult?.success ? "[wa:sent]" : reason === "cooldown_or_duplicate" ? "[wa:skipped]" : "[wa:failed]";

  const transportStatus = sendResult
    ? ` status=${sendResult.statusCode || "n/a"} success=${Boolean(sendResult.success)}`
    : " status=n/a success=false";

  const detail = sendResult?.error ? ` error=${sendResult.error}` : "";
  const why = reason ? ` reason=${reason}` : "";

  return StudentAction.create(
    {
      student_id: studentId,
      type,
      content: `${prefix} [automation:${situation}]${transportStatus}${why}${detail} ${message}`,
      created_at: new Date()
    },
    { transaction }
  );
};

const shouldSkipBySafety = async ({ studentId, actionType, message, now }) => {
  const [recentAttempt, duplicateMessage] = await Promise.all([
    findRecentWhatsappAttempt({ studentId, actionType, now }),
    findRecentSameMessage({ studentId, actionType, message, now })
  ]);

  if (recentAttempt || duplicateMessage) {
    return true;
  }

  return false;
};

const triggerStudentRecovery = async (student) => {
  if (!student?.id) {
    throw new AppError("student with id is required", 400);
  }

  const persistedStudent = await Student.findByPk(student.id);
  if (!persistedStudent) {
    throw new AppError("Student not found", 404);
  }

  const now = new Date();
  const situation = resolveSituation(persistedStudent, now);

  if (!situation) {
    return {
      student_id: persistedStudent.id,
      skipped: true,
      reason: "No recovery trigger for current status"
    };
  }

  const trackingType = detectTrackingTypeForSituation(situation);
  const messageTemplate = await generateWhatsAppMessage(persistedStudent, situation);
  const message = whatsappService.attachTrackingLink({
    studentId: persistedStudent.id,
    trackingType,
    message: messageTemplate
  });

  const actionType = getRequiredActionType(detectActionTypeForSituation(situation));

  const transaction = await sequelize.transaction();
  try {
    const skipSend = await shouldSkipBySafety({
      studentId: persistedStudent.id,
      actionType,
      message,
      now
    });

    let sendResult;
    let reason = null;

    if (skipSend) {
      sendResult = { success: false, statusCode: 429, error: "Message skipped by cooldown/idempotency" };
      reason = "cooldown_or_duplicate";
    } else {
      sendResult = await whatsappService.sendMessage(persistedStudent.phone, message);
    }

    await logRecoveryAction({
      studentId: persistedStudent.id,
      situation,
      message,
      sendResult,
      reason,
      transaction
    });

    persistedStudent.last_action_at = now;
    await persistedStudent.save({ transaction });

    await transaction.commit();

    return {
      student_id: persistedStudent.id,
      situation,
      skipped: skipSend,
      message,
      send_result: sendResult
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

const processAtRiskBatch = async () => {
  ensureStatusSupported("at_risk");

  const students = await Student.findAll({
    where: { status: "at_risk" },
    order: [["last_action_at", "ASC"], ["created_at", "ASC"]]
  });

  const results = [];

  for (const student of students) {
    try {
      const outcome = await triggerStudentRecovery(student);
      results.push({ success: true, student_id: student.id, outcome });
    } catch (error) {
      results.push({
        success: false,
        student_id: student.id,
        error: error.message
      });
    }
  }

  return {
    total: students.length,
    processed: results.length,
    succeeded: results.filter((row) => row.success).length,
    failed: results.filter((row) => !row.success).length,
    results
  };
};

const escalationRules = async (student) => {
  if (!student?.id) {
    throw new AppError("student with id is required", 400);
  }

  const persistedStudent = await Student.findByPk(student.id);
  if (!persistedStudent) {
    throw new AppError("Student not found", 404);
  }

  const now = new Date();
  const lastActionAt = persistedStudent.last_action_at
    ? new Date(persistedStudent.last_action_at)
    : new Date(persistedStudent.created_at);
  const inactivityMs = now.getTime() - lastActionAt.getTime();

  let appliedRule = null;
  let nextStatus = null;
  let situation = null;

  if (persistedStudent.status === "at_risk" && inactivityMs > DAY_MS) {
    appliedRule = "at_risk_over_24h";
    situation = "at_risk_strong";
  }

  if (persistedStudent.status === "blocked" && inactivityMs > 2 * DAY_MS) {
    appliedRule = "blocked_over_48h";
    situation = "blocked_escalation";
  }

  if (inactivityMs > 3 * DAY_MS && persistedStudent.status !== "inactive") {
    ensureStatusSupported("inactive");
    appliedRule = "no_response_over_72h";
    situation = "inactive";
    nextStatus = "inactive";
  }

  if (!appliedRule) {
    return {
      student_id: persistedStudent.id,
      applied: false,
      reason: "No escalation rule matched"
    };
  }

  const trackingType = detectTrackingTypeForSituation(situation);
  const messageTemplate = await generateWhatsAppMessage(persistedStudent, situation);
  const message = whatsappService.attachTrackingLink({
    studentId: persistedStudent.id,
    trackingType,
    message: messageTemplate
  });

  const transaction = await sequelize.transaction();
  try {
    if (nextStatus) {
      persistedStudent.status = nextStatus;
    }

    const actionType = getRequiredActionType(detectActionTypeForSituation(situation));
    const skipSend = await shouldSkipBySafety({
      studentId: persistedStudent.id,
      actionType,
      message,
      now
    });

    let sendResult;
    let reason = null;

    if (skipSend) {
      sendResult = { success: false, statusCode: 429, error: "Message skipped by cooldown/idempotency" };
      reason = "cooldown_or_duplicate";
    } else {
      sendResult = await whatsappService.sendMessage(persistedStudent.phone, message);
    }

    persistedStudent.last_action_at = now;
    await persistedStudent.save({ transaction });

    await logRecoveryAction({
      studentId: persistedStudent.id,
      situation,
      message,
      sendResult,
      reason,
      transaction
    });

    await transaction.commit();

    return {
      student_id: persistedStudent.id,
      applied: true,
      rule: appliedRule,
      status: persistedStudent.status,
      situation,
      skipped: skipSend,
      send_result: sendResult
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

module.exports = {
  triggerStudentRecovery,
  generateWhatsAppMessage,
  processAtRiskBatch,
  escalationRules
};
