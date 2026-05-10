const { Op } = require("sequelize");
const { Task, Student, StudentAction, User, sequelize } = require("../models");

const OPEN_STATUSES = ["pending", "in_progress"];
const SERIALIZE_TASK_WRITES = (process.env.DB_DIALECT || "mysql") === "sqlite";
let taskWriteQueue = Promise.resolve();
const TYPES = [
  "onboarding_issue",
  "payment_issue",
  "server_activation_issue",
  "motivation_issue",
  "technical_issue"
];
const STATUSES = ["pending", "in_progress", "resolved"];
const PRIORITIES = ["urgent", "normal", "low"];

const normalize = (value) => String(value || "").trim();
const toPositiveInt = (value) => Number.parseInt(value, 10);

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const withTaskWriteLock = (task) => {
  if (!SERIALIZE_TASK_WRITES) {
    return task();
  }

  const run = taskWriteQueue.then(() => task(), () => task());
  taskWriteQueue = run.catch(() => undefined);
  return run;
};

const ensurePositiveId = (value, name) => {
  const parsed = toPositiveInt(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createError(`Invalid ${name}`, 400);
  }
  return parsed;
};

const ensureStudent = async (studentId, options = {}) => {
  const student = await Student.findByPk(studentId, {
    transaction: options.transaction,
    lock: options.transaction ? options.transaction.LOCK.UPDATE : undefined
  });

  if (!student) {
    throw createError("Student not found", 404);
  }

  return student;
};

const ensureUser = async (userId, options = {}) => {
  const user = await User.findByPk(userId, { transaction: options.transaction });
  if (!user) {
    throw createError("Assigned user not found", 404);
  }
  return user;
};

const normalizeTaskType = (type) => {
  const normalized = normalize(type).toLowerCase();
  if (!TYPES.includes(normalized)) {
    throw createError("Invalid task type", 400);
  }
  return normalized;
};

const normalizePriority = (priority = "normal") => {
  const normalized = normalize(priority || "normal").toLowerCase();
  if (!PRIORITIES.includes(normalized)) {
    throw createError("Invalid task priority", 400);
  }
  return normalized;
};

const normalizeStatus = (status = "pending") => {
  const normalized = normalize(status || "pending").toLowerCase();
  if (!STATUSES.includes(normalized)) {
    throw createError("Invalid task status", 400);
  }
  return normalized;
};

const findOpenTask = ({ studentId, type, transaction }) => {
  return Task.findOne({
    where: {
      student_id: studentId,
      type,
      status: { [Op.in]: OPEN_STATUSES }
    },
    order: [["created_at", "ASC"]],
    transaction
  });
};

const touchStudentWithAction = async ({ student, type = "support", content, now, transaction }) => {
  await StudentAction.create(
    {
      student_id: student.id,
      type,
      content,
      created_at: now
    },
    { transaction }
  );

  student.last_action_at = now;
  await student.save({ transaction });
};

const createTask = async ({ studentId, type, priority = "normal", assignedTo = null, notes = "", status = "pending" }) => {
  const parsedStudentId = ensurePositiveId(studentId, "studentId");
  const taskType = normalizeTaskType(type);
  const taskPriority = normalizePriority(priority);
  const taskStatus = normalizeStatus(status);
  const normalizedNotes = normalize(notes);
  const parsedAssignedTo = assignedTo === null || assignedTo === undefined || assignedTo === ""
    ? null
    : ensurePositiveId(assignedTo, "assignedTo");

  return withTaskWriteLock(() => sequelize.transaction(async (transaction) => {
    const student = await ensureStudent(parsedStudentId, { transaction });

    if (parsedAssignedTo) {
      await ensureUser(parsedAssignedTo, { transaction });
    }

    const existing = await findOpenTask({
      studentId: student.id,
      type: taskType,
      transaction
    });

    if (existing) {
      return { task: existing, created: false };
    }

    const now = new Date();
    const task = await Task.create(
      {
        student_id: student.id,
        type: taskType,
        status: taskStatus,
        priority: taskPriority,
        assigned_to: parsedAssignedTo,
        notes: normalizedNotes || null,
        created_at: now,
        resolved_at: taskStatus === "resolved" ? now : null
      },
      { transaction }
    );

    await touchStudentWithAction({
      student,
      content: `Support task created: ${taskType}`,
      now,
      transaction
    });

    return { task, created: true };
  }));
};

const getOpenTasks = () => {
  return Task.findAll({
    where: { status: { [Op.in]: OPEN_STATUSES } },
    include: [
      { model: Student, as: "student", attributes: ["id", "name", "phone", "status", "last_action_at"] },
      { model: User, as: "assignee", attributes: ["id", "name", "email", "role"], required: false }
    ],
    order: [["priority", "ASC"], ["created_at", "ASC"]]
  });
};

const getStudentTasks = (studentId) => {
  const parsedStudentId = ensurePositiveId(studentId, "studentId");
  return Task.findAll({
    where: { student_id: parsedStudentId },
    include: [{ model: User, as: "assignee", attributes: ["id", "name", "email", "role"], required: false }],
    order: [["created_at", "DESC"]]
  });
};

const assignTask = async ({ taskId, assignedTo, notes = "" }) => {
  const parsedTaskId = ensurePositiveId(taskId, "taskId");
  const parsedAssignedTo = ensurePositiveId(assignedTo, "assignedTo");
  const normalizedNotes = normalize(notes);

  return withTaskWriteLock(() => sequelize.transaction(async (transaction) => {
    const task = await Task.findByPk(parsedTaskId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!task) {
      throw createError("Task not found", 404);
    }
    if (task.status === "resolved") {
      throw createError("Resolved task cannot be assigned", 400);
    }

    await ensureUser(parsedAssignedTo, { transaction });
    const student = await ensureStudent(task.student_id, { transaction });
    const now = new Date();

    task.assigned_to = parsedAssignedTo;
    task.status = "in_progress";
    if (normalizedNotes) {
      task.notes = task.notes ? `${task.notes}\n${normalizedNotes}` : normalizedNotes;
    }
    await task.save({ transaction });

    await touchStudentWithAction({
      student,
      content: `Support task assigned: ${task.type}`,
      now,
      transaction
    });

    return task;
  }));
};

const resolveTask = async ({ taskId, notes = "" }) => {
  const parsedTaskId = ensurePositiveId(taskId, "taskId");
  const normalizedNotes = normalize(notes);

  return withTaskWriteLock(() => sequelize.transaction(async (transaction) => {
    const task = await Task.findByPk(parsedTaskId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!task) {
      throw createError("Task not found", 404);
    }
    if (task.status === "resolved") {
      return task;
    }

    const student = await ensureStudent(task.student_id, { transaction });
    const now = new Date();

    task.status = "resolved";
    task.resolved_at = now;
    if (normalizedNotes) {
      task.notes = task.notes ? `${task.notes}\n${normalizedNotes}` : normalizedNotes;
    }
    await task.save({ transaction });

    await touchStudentWithAction({
      student,
      content: `Support task resolved: ${task.type}`,
      now,
      transaction
    });

    return task;
  }));
};

const ensureTasksForStudent = async (student, options = {}) => {
  if (!student?.id) {
    return [];
  }

  const created = [];
  const now = options.now || new Date();
  const status = normalize(student.status).toLowerCase();
  const reference = student.last_action_at ? new Date(student.last_action_at) : new Date(student.created_at);
  const ageMs = now.getTime() - reference.getTime();

  if (status === "at_risk") {
    created.push(await createTask({
      studentId: student.id,
      type: "motivation_issue",
      priority: "urgent",
      notes: "Auto-created because student is at_risk"
    }));
  }

  if (status === "blocked") {
    created.push(await createTask({
      studentId: student.id,
      type: "technical_issue",
      priority: "urgent",
      notes: "Auto-created because student is blocked"
    }));
  }

  if (status === "onboarding" && ageMs > 48 * 60 * 60 * 1000) {
    created.push(await createTask({
      studentId: student.id,
      type: "onboarding_issue",
      priority: "urgent",
      notes: "Auto-created because onboarding has been stalled for more than 48h"
    }));
  }

  return created;
};

module.exports = {
  createTask,
  getOpenTasks,
  getStudentTasks,
  assignTask,
  resolveTask,
  ensureTasksForStudent,
  OPEN_STATUSES
};
