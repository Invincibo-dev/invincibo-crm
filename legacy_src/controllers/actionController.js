const activationService = require("../services/activationService");
const { AppError } = require("../services/errors");

const toPositiveInt = (value) => Number.parseInt(value, 10);
const normalize = (value) => String(value || "").trim();

const createStudentAction = async (req, res, next) => {
  try {
    const studentId = toPositiveInt(req.params.id);
    const type = normalize(req.body?.type).toLowerCase();
    const content = normalize(req.body?.content);

    if (!Number.isInteger(studentId) || studentId <= 0) {
      throw new AppError("Invalid student id", 400);
    }
    if (!type || !content) {
      throw new AppError("type and content are required", 400);
    }

    const action = await activationService.logAction(studentId, type, content);
    return res.status(201).json(action);
  } catch (error) {
    return next(error);
  }
};

const getStudentActions = async (req, res, next) => {
  try {
    const studentId = toPositiveInt(req.params.id);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      throw new AppError("Invalid student id", 400);
    }

    const actions = await activationService.listStudentActions(studentId);
    return res.json(actions);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createStudentAction,
  getStudentActions
};