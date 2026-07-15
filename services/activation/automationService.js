const { Op } = require("sequelize");
const { Message, Student, StudentAction, sequelize } = require("../../models");
const activationService = require("./activationService");
const whatsappService = require("./whatsappService");
const { AppError } = require("./errors");
const taskService = require("../taskService");
const { canSendWhatsApp } = require("../whatsappConsentService");
const { isWhatsAppSendingEnabled } = require("../../config/whatsapp");

const DAY_MS = 24 * 60 * 60 * 1000;
const WHATSAPP_COOLDOWN_HOURS = Number(process.env.WHATSAPP_COOLDOWN_HOURS || 6);
const WHATSAPP_COOLDOWN_MS = WHATSAPP_COOLDOWN_HOURS * 60 * 60 * 1000;

const normalize = (value) => String(value || "").trim();

const getStatusValues = () => Student.getAttributes().status?.values || [];

const ensureStatusSupported = (status) => {
  if (!getStatusValues().includes(status)) {
    throw new AppError(`Student status "${status}" is not supported by model enum`, 500);
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
        [Op.or]: [
          { [Op.like]: "[wa:accepted]%" },
          { [Op.like]: "[wa:sent]%" },
          { [Op.like]: "[wa:failed]%" },
          { [Op.like]: "[wa:skipped]%" }
        ]
      }
    },
    order: [["created_at", "DESC"]]
  });
};

const logRecoveryAction = async ({
  studentId,
  situation,
  message,
  sendResult,
  reason = null,
  transaction
}) => {
  const preferredType = detectActionTypeForSituation(situation);
  const type = getRequiredActionType(preferredType);
  const prefix = sendResult?.success ? "[wa:accepted]" : reason ? "[wa:skipped]" : "[wa:failed]";
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

  return Boolean(recentAttempt || duplicateMessage);
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
  await taskService.ensureTasksForStudent(persistedStudent, { now });

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
  const policy = canSendWhatsApp(persistedStudent, "utility");
  const skipSend = await shouldSkipBySafety({
    studentId: persistedStudent.id,
    actionType,
    message,
    now
  });

  let sendResult;
  let reason = null;
  let delivery = null;

  if (!policy.allowed) {
    sendResult = {
      success: false,
      skipped: true,
      status: "skipped_opt_out",
      statusCode: 0,
      error: policy.reason
    };
    reason = "skipped_opt_out";
    delivery = await Message.create({
      student_id: persistedStudent.id,
      message,
      type: "recovery",
      status: "skipped_opt_out",
      source: "activation",
      delivery_evidence: "no_meta_request"
    });
  } else if (skipSend) {
    sendResult = {
      success: false,
      statusCode: 429,
      error: "Message skipped by cooldown/idempotency"
    };
    reason = "cooldown_or_duplicate";
  } else if (!isWhatsAppSendingEnabled()) {
    sendResult = {
      success: false,
      statusCode: 0,
      error: "WhatsApp sending is disabled by WHATSAPP_SEND_ENABLED"
    };
    reason = "sending_disabled";
  } else if (process.env.NODE_ENV !== "test" && !whatsappService.hasConfig()) {
    sendResult = {
      success: false,
      statusCode: 0,
      error: "WhatsApp configuration is unavailable"
    };
    reason = "configuration_unavailable";
  } else {
    delivery = await Message.create({
      student_id: persistedStudent.id,
      message,
      type: "recovery",
      status: "pending",
      source: "activation",
      delivery_evidence: "no_meta_request"
    });
    await delivery.update({ delivery_evidence: "meta_request_started" });
    sendResult = await whatsappService.sendMessage(persistedStudent, message, "utility");
    const providerMessageId = sendResult?.data?.messages?.[0]?.id;
    if (sendResult.success && providerMessageId) {
      await delivery.update({
        status: "accepted",
        meta_status: "accepted",
        meta_message_id: providerMessageId,
        accepted_at: new Date(),
        delivery_evidence: "meta_accepted"
      });
    } else {
      const ambiguous = Boolean(
        sendResult.deliveryAmbiguous || (sendResult.success && !providerMessageId)
      );
      if (sendResult.success && !providerMessageId) {
        sendResult = {
          ...sendResult,
          success: false,
          deliveryAmbiguous: true,
          error: "Meta accepted the request without returning a WhatsApp message id"
        };
      }
      await delivery.update({
        status: ambiguous ? "pending" : "failed",
        meta_status: ambiguous ? null : "failed",
        failed_at: ambiguous ? null : new Date(),
        delivery_evidence: ambiguous ? "ambiguous" : "meta_request_started",
        meta_error_message: String(
          sendResult.error || "Meta accepted the request without returning a WhatsApp message id"
        ).slice(0, 2000)
      });
    }
  }

  const transaction = await sequelize.transaction();

  try {
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
      skipped: skipSend || !policy.allowed,
      status: reason || (sendResult.success ? "accepted" : "failed"),
      message,
      send_result: sendResult,
      message_id: delivery?.id || null
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
    order: [
      ["last_action_at", "ASC"],
      ["created_at", "ASC"]
    ]
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

module.exports = {
  triggerStudentRecovery,
  generateWhatsAppMessage,
  processAtRiskBatch,
  resolveSituation
};
