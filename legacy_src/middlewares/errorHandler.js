const { AppError } = require("../services/errors");

const errorHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  if (error.name === "SequelizeValidationError") {
    return res.status(400).json({ message: error.errors[0]?.message || "Validation error" });
  }

  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({ message: "Duplicate value" });
  }

  return res.status(error.statusCode || 500).json({
    message: "Internal server error",
    error: process.env.NODE_ENV === "production" ? undefined : error.message
  });
};

module.exports = { errorHandler };