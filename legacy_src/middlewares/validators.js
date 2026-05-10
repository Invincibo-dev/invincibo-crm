const { AppError } = require("../services/errors");

const validateStudentId = (req, _res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return next(new AppError("Invalid student id", 400));
  }
  return next();
};

module.exports = {
  validateStudentId
};