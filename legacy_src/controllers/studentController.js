const activationService = require("../services/activationService");
const { AppError } = require("../services/errors");

const toPositiveInt = (value) => Number.parseInt(value, 10);
const normalize = (value) => String(value || "").trim();

const getStudents = async (req, res, next) => {
  try {
    const status = normalize(req.query.status).toLowerCase();
    const students = await activationService.listStudents({ status: status || undefined });
    return res.json(students);
  } catch (error) {
    return next(error);
  }
};

const createStudent = async (req, res, next) => {
  try {
    const name = normalize(req.body?.name);
    const phone = normalize(req.body?.phone);
    const status = normalize(req.body?.status).toLowerCase();

    if (!name || !phone) {
      throw new AppError("name and phone are required", 400);
    }

    const student = await activationService.createStudent({
      name,
      phone,
      status: status || undefined
    });

    return res.status(201).json(student);
  } catch (error) {
    return next(error);
  }
};

const getStudentById = async (req, res, next) => {
  try {
    const studentId = toPositiveInt(req.params.id);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      throw new AppError("Invalid student id", 400);
    }

    const student = await activationService.getStudentById(studentId);
    return res.json(student);
  } catch (error) {
    return next(error);
  }
};

const updateStudentStatus = async (req, res, next) => {
  try {
    const studentId = toPositiveInt(req.params.id);
    const status = normalize(req.body?.status).toLowerCase();

    if (!Number.isInteger(studentId) || studentId <= 0) {
      throw new AppError("Invalid student id", 400);
    }
    if (!status) {
      throw new AppError("status is required", 400);
    }

    const student = await activationService.updateStudentProgress(studentId, status);
    return res.json(student);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getStudents,
  createStudent,
  getStudentById,
  updateStudentStatus
};