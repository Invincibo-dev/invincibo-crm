const { Op } = require("sequelize");
const { Student, StudentAction, sequelize } = require("../models");
const { AppError } = require("./errors");
const { withStudentLock } = require("./studentLock");
const trackingService = require("./trackingService");

const ACTION_TO_STATUS = {
  onboarding_start: "onboarding",
  step1_complete: "step1",
  server_activated: "active",
  onboarding: "onboarding",
  step1: "step1",
  active: "active"
};

const STATUS_TO_ACTION_TYPE = {
  onboarding: "onboarding",
  step1: "step1",
  active: "activation"
};

const NEXT_RECOMMENDED_STEP = {
  paid_training: "onboarding_start",
  onboarding: "step1_complete",
  step1: "server_activated",
  active: "monitor_engagement",
  inactive: "reactivation_follow_up",
  blocked: "manual_review",
  at_risk: "immediate_reengagement"
};

const HISTORY_LIMIT = 10;
const ACTION_DEDUP_WINDOW_MS = Number(process.env.ACTION_DEDUP_WINDOW_MS || 90 * 1000);
const CONCURRENCY_CHUNK = Number(process.env.AT_RISK_CHUNK_SIZE || 25);

const normalize = (value) => String(value || "").trim();
const toPositiveInt = (value) => Number.parseInt(value, 10);

const getStatusValues = () => Student.getAttributes().status?.values || [];
const getActionTypeValues = () => StudentAction.getAttributes().type?.values || [];

const ensureStatusSupported = (status) => {
  if (!getStatusValues().includes(status)) {
    throw new AppError(`Student status "${status}" is not supported by model enum`, 500);
  }
};

const ensureStudentId = (studentId) => {
  const parsed = toPositiveInt(studentId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError("Invalid studentId", 400);
  }
  return parsed;
};

const normalizeActionTypeForLog = (rawType, fallback = "support") => {
  const normalized = normalize(rawType).toLowerCase();
  const allowed = getActionTypeValues();

  if (allowed.includes(normalized)) {
    return normalized;
  }
  if (allowed.includes(fallback)) {
    return fallback;
  }

  throw new AppError("StudentAction type enum is missing required values", 500);
};

const ensureStudentExists = async (studentId, options = {}) => {
  const student = await Student.findByPk(studentId, {
    transaction: options.transaction,
    lock: options.transaction ? options.transaction.LOCK.UPDATE : undefined
  });

  if (!student) {
    throw new AppError("Student not found", 404);
  }

  return student;
};

const findRecentDuplicateAction = async ({ studentId, type, content, now, transaction }) => {
  const minDate = new Date(now.getTime() - ACTION_DEDUP_WINDOW_MS);

  return StudentAction.findOne({
    where: {
      student_id: studentId,
      type,
      content,
      created_at: { [Op.gte]: minDate }
    },
    order: [["created_at", "DESC"]],
    transaction
  });
};

const createActionWithIdempotency = async ({ studentId, type, content, now, transaction }) => {
  const duplicate = await findRecentDuplicateAction({
    studentId,
    type,
    content,
    now,
    transaction
  });

  if (duplicate) {
    return { action: duplicate, deduplicated: true };
  }

  const action = await StudentAction.create(
    {
      student_id: studentId,
      type,
      content,
      created_at: now
    },
    { transaction }
  );

  return { action, deduplicated: false };
};

const runInChunks = async (items, handler, chunkSize) => {
  const results = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map((item) => handler(item)));
    results.push(...chunkResults);
  }

  return results;
};

const createStudent = async ({ name, phone, status = "paid_training" }) => {
  const normalizedName = normalize(name);
  const normalizedPhone = normalize(phone);
  const normalizedStatus = normalize(status).toLowerCase();

  if (!normalizedName || !normalizedPhone) {
    throw new AppError("name and phone are required", 400);
  }

  ensureStatusSupported(normalizedStatus);

  return withStudentLock(`phone:${normalizedPhone}`, () =>
    sequelize.transaction(async (transaction) => {
      const now = new Date();

      const student = await Student.create(
        {
          name: normalizedName,
          phone: normalizedPhone,
          status: normalizedStatus,
          created_at: now,
          last_action_at: now
        },
        { transaction }
      );

      await createActionWithIdempotency({
        studentId: student.id,
        type: normalizeActionTypeForLog("message"),
        content: `Student created with status ${normalizedStatus}`,
        now,
        transaction
      });

      return student;
    })
  );
};

const listStudents = async ({ status } = {}) => {
  const where = {};
  const normalizedStatus = normalize(status).toLowerCase();

  if (normalizedStatus) {
    where.status = normalizedStatus;
  }

  return Student.findAll({
    where,
    order: [["created_at", "DESC"]]
  });
};

const getStudentById = async (studentId) => {
  const parsedStudentId = ensureStudentId(studentId);

  const student = await Student.findByPk(parsedStudentId, {
    include: [
      {
        model: StudentAction,
        as: "actions",
        required: false,
        separate: true,
        order: [["created_at", "DESC"]]
      }
    ]
  });

  if (!student) {
    throw new AppError("Student not found", 404);
  }

  return student;
};

const listStudentActions = async (studentId) => {
  const parsedStudentId = ensureStudentId(studentId);

  await ensureStudentExists(parsedStudentId);

  return StudentAction.findAll({
    where: { student_id: parsedStudentId },
    order: [["created_at", "DESC"]]
  });
};

const logAction = async (studentId, type, content) => {
  const parsedStudentId = ensureStudentId(studentId);
  const normalizedContent = normalize(content);

  if (!normalizedContent) {
    throw new AppError("content is required", 400);
  }

  const actionType = normalizeActionTypeForLog(type);

  return withStudentLock(parsedStudentId, () =>
    sequelize.transaction(async (transaction) => {
      const student = await ensureStudentExists(parsedStudentId, { transaction });
      const now = new Date();

      const { action } = await createActionWithIdempotency({
        studentId: student.id,
        type: actionType,
        content: normalizedContent,
        now,
        transaction
      });

      student.last_action_at = now;
      await student.save({ transaction });

      return action;
    })
  );
};

const updateStudentProgress = async (studentId, actionType) => {
  const parsedStudentId = ensureStudentId(studentId);
  const normalizedActionType = normalize(actionType).toLowerCase();
  const nextStatus = ACTION_TO_STATUS[normalizedActionType];

  if (!nextStatus) {
    throw new AppError("Invalid actionType", 400);
  }

  ensureStatusSupported(nextStatus);

  return withStudentLock(parsedStudentId, () =>
    sequelize.transaction(async (transaction) => {
      const student = await ensureStudentExists(parsedStudentId, { transaction });
      const now = new Date();

      if (student.status !== nextStatus) {
        student.status = nextStatus;
      }
      student.last_action_at = now;
      await student.save({ transaction });

      const logType = normalizeActionTypeForLog(STATUS_TO_ACTION_TYPE[nextStatus] || "support");
      await createActionWithIdempotency({
        studentId: student.id,
        type: logType,
        content: `Progress updated via ${normalizedActionType}. Status is now ${nextStatus}`,
        now,
        transaction
      });

      if (normalizedActionType === "server_activated") {
        await trackingService.logConversionEvent(student.id, "system", transaction);
      }

      return student;
    })
  );
};

const evaluateStaleness = (student, now) => {
  const reference = student.last_action_at ? new Date(student.last_action_at) : new Date(student.created_at);
  return now.getTime() - reference.getTime();
};

const tryEscalateStatus = async ({ studentId, targetStatus, now }) => {
  return withStudentLock(studentId, () =>
    sequelize.transaction(async (transaction) => {
      const student = await ensureStudentExists(studentId, { transaction });
      const ageMs = evaluateStaleness(student, now);

      if (targetStatus === "blocked") {
        if (student.status !== "onboarding" || ageMs <= 48 * 60 * 60 * 1000) {
          return null;
        }
      }

      if (targetStatus === "at_risk") {
        if (["blocked", "at_risk"].includes(student.status) || ageMs <= 24 * 60 * 60 * 1000) {
          return null;
        }
      }

      student.status = targetStatus;
      await student.save({ transaction });

      await createActionWithIdempotency({
        studentId: student.id,
        type: normalizeActionTypeForLog("support"),
        content:
          targetStatus === "blocked"
            ? "Student blocked: no progression for more than 48h after onboarding"
            : "Student marked at_risk: no activity for more than 24h",
        now,
        transaction
      });

      return student.id;
    })
  );
};

const checkAtRiskStudents = async () => {
  ensureStatusSupported("at_risk");
  ensureStatusSupported("blocked");

  const now = new Date();
  const atRiskCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const blockedCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const blockedCandidates = await Student.findAll({
    attributes: ["id"],
    where: {
      status: "onboarding",
      [Op.or]: [{ last_action_at: null }, { last_action_at: { [Op.lte]: blockedCutoff } }]
    },
    order: [["id", "ASC"]],
    raw: true
  });

  await runInChunks(
    blockedCandidates.map((row) => row.id),
    async (studentId) => tryEscalateStatus({ studentId, targetStatus: "blocked", now }),
    CONCURRENCY_CHUNK
  );

  const atRiskCandidates = await Student.findAll({
    attributes: ["id"],
    where: {
      status: { [Op.notIn]: ["blocked", "at_risk"] },
      [Op.or]: [
        { last_action_at: { [Op.lte]: atRiskCutoff } },
        { [Op.and]: [{ last_action_at: null }, { created_at: { [Op.lte]: atRiskCutoff } }] }
      ]
    },
    order: [["id", "ASC"]],
    raw: true
  });

  await runInChunks(
    atRiskCandidates.map((row) => row.id),
    async (studentId) => tryEscalateStatus({ studentId, targetStatus: "at_risk", now }),
    CONCURRENCY_CHUNK
  );

  return Student.findAll({
    attributes: ["id", "name", "phone", "status", "last_action_at", "created_at"],
    where: { status: "at_risk" },
    order: [["last_action_at", "ASC"], ["created_at", "ASC"]]
  });
};

const getStudentStatusFlow = async (studentId) => {
  const parsedStudentId = ensureStudentId(studentId);

  const student = await ensureStudentExists(parsedStudentId);
  const actions = await StudentAction.findAll({
    where: { student_id: student.id },
    order: [["created_at", "DESC"]],
    limit: HISTORY_LIMIT
  });

  return {
    student: {
      id: student.id,
      name: student.name,
      phone: student.phone,
      created_at: student.created_at
    },
    current_status: student.status,
    last_action_at: student.last_action_at,
    last_actions: actions,
    next_recommended_step: NEXT_RECOMMENDED_STEP[student.status] || "manual_review"
  };
};

module.exports = {
  createStudent,
  listStudents,
  getStudentById,
  listStudentActions,
  updateStudentProgress,
  logAction,
  checkAtRiskStudents,
  getStudentStatusFlow
};



