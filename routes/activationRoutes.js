const express = require("express");
const { Op, fn, col } = require("sequelize");
const activationService = require("../services/activation/activationService");
const automationService = require("../services/activation/automationService");
const taskController = require("../controllers/taskController");
const { Student } = require("../models");
const { authorizeRoles } = require("../middleware/authMiddleware");
const { getPagination, sendCollection } = require("../services/pagination");

const router = express.Router();

const normalize = (value) => String(value || "").trim();
const toPositiveInt = (value) => Number.parseInt(value, 10);

const requireStudentId = (req, res, next) => {
  const studentId = toPositiveInt(req.params.id);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    return res.status(400).json({ message: "Invalid student id" });
  }
  req.studentId = studentId;
  return next();
};

router.get("/tasks", authorizeRoles("admin", "agent"), taskController.getOpenTasks);
router.post("/tasks", authorizeRoles("admin", "agent"), taskController.createTask);
router.patch("/tasks/:id/assign", authorizeRoles("admin", "agent"), taskController.assignTask);
router.patch("/tasks/:id/resolve", authorizeRoles("admin", "agent"), taskController.resolveTask);

router.get("/students", authorizeRoles("admin", "agent"), async (req, res, next) => {
  try {
    const status = normalize(req.query.status).toLowerCase();
    const pagination = getPagination(req.query);
    const { rows, count } = await activationService.listStudents({
      status: status || undefined,
      limit: pagination.limit,
      offset: pagination.offset
    });
    return sendCollection(res, rows, count, pagination);
  } catch (error) {
    return next(error);
  }
});

router.post("/students", authorizeRoles("admin", "agent"), async (req, res, next) => {
  try {
    const student = await activationService.createStudent({
      name: req.body?.name,
      phone: req.body?.phone,
      status: req.body?.status,
      whatsappOptIn: req.body?.whatsapp_opt_in === true,
      whatsappOptInSource: req.body?.whatsapp_opt_in_source,
      createdBy: req.user.id
    });
    return res.status(201).json(student);
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/students/:id",
  authorizeRoles("admin", "agent"),
  requireStudentId,
  async (req, res, next) => {
    try {
      const student = await activationService.getStudentById(req.studentId);
      return res.json(student);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/students/:id/status",
  authorizeRoles("admin", "agent"),
  requireStudentId,
  async (req, res, next) => {
    try {
      const student = await activationService.updateStudentProgress(
        req.studentId,
        req.body?.status
      );
      return res.json(student);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/students/:id/actions",
  authorizeRoles("admin", "agent"),
  requireStudentId,
  async (req, res, next) => {
    try {
      const actions = await activationService.listStudentActions(req.studentId);
      return res.json(actions);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/students/:id/actions",
  authorizeRoles("admin", "agent"),
  requireStudentId,
  async (req, res, next) => {
    try {
      const action = await activationService.logAction(
        req.studentId,
        req.body?.type,
        req.body?.content
      );
      return res.status(201).json(action);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/students/:id/flow",
  authorizeRoles("admin", "agent"),
  requireStudentId,
  async (req, res, next) => {
    try {
      const flow = await activationService.getStudentStatusFlow(req.studentId);
      return res.json(flow);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/students/:id/recovery",
  authorizeRoles("admin", "agent"),
  requireStudentId,
  async (req, res, next) => {
    try {
      const outcome = await automationService.triggerStudentRecovery({ id: req.studentId });
      return res.json(outcome);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/at-risk/check", authorizeRoles("admin", "agent"), async (_req, res, next) => {
  try {
    const students = await activationService.checkAtRiskStudents();
    return res.json(students);
  } catch (error) {
    return next(error);
  }
});

router.post("/at-risk/recover", authorizeRoles("admin", "agent"), async (_req, res, next) => {
  try {
    const outcome = await automationService.processAtRiskBatch();
    return res.json(outcome);
  } catch (error) {
    return next(error);
  }
});

router.get("/dashboard/summary", authorizeRoles("admin", "agent"), async (_req, res, next) => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [statusRows, atRiskStudents] = await Promise.all([
      Student.findAll({
        attributes: ["status", [fn("COUNT", col("id")), "count"]],
        group: ["status"],
        raw: true
      }),
      Student.findAll({
        attributes: ["id", "name", "phone", "status", "last_action_at", "created_at"],
        where: {
          [Op.or]: [
            { last_action_at: { [Op.lte]: cutoff } },
            {
              [Op.and]: [{ last_action_at: null }, { created_at: { [Op.lte]: cutoff } }]
            }
          ]
        },
        order: [
          ["last_action_at", "ASC"],
          ["created_at", "ASC"]
        ]
      })
    ]);

    const counts = {
      paid_training: 0,
      onboarding: 0,
      step1: 0,
      active: 0,
      inactive: 0,
      blocked: 0,
      at_risk: 0
    };

    for (const row of statusRows) {
      if (Object.prototype.hasOwnProperty.call(counts, row.status)) {
        counts[row.status] = Number(row.count) || 0;
      }
    }

    return res.json({
      ...counts,
      at_risk_students: atRiskStudents
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
