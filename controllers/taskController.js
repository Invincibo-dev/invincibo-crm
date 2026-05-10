const taskService = require("../services/taskService");

const createTask = async (req, res, next) => {
  try {
    const { task, created } = await taskService.createTask({
      studentId: req.body?.student_id,
      type: req.body?.type,
      priority: req.body?.priority,
      assignedTo: req.body?.assigned_to,
      notes: req.body?.notes,
      status: req.body?.status
    });

    return res.status(created ? 201 : 200).json(task);
  } catch (error) {
    return next(error);
  }
};

const getOpenTasks = async (_req, res, next) => {
  try {
    const tasks = await taskService.getOpenTasks();
    return res.json(tasks);
  } catch (error) {
    return next(error);
  }
};

const assignTask = async (req, res, next) => {
  try {
    const task = await taskService.assignTask({
      taskId: req.params.id,
      assignedTo: req.body?.assigned_to,
      notes: req.body?.notes
    });

    return res.json(task);
  } catch (error) {
    return next(error);
  }
};

const resolveTask = async (req, res, next) => {
  try {
    const task = await taskService.resolveTask({
      taskId: req.params.id,
      notes: req.body?.notes
    });

    return res.json(task);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createTask,
  getOpenTasks,
  assignTask,
  resolveTask
};
