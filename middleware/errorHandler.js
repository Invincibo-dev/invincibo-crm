const errorHandler = (err, _req, res, _next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body too large" });
  }
  if (err.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({ message: "Duplicate value detected" });
  }

  if (err.name === "SequelizeValidationError") {
    return res.status(400).json({ message: err.errors[0]?.message || "Invalid data" });
  }

  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return res.status(401).json({ message: "Unauthorized: invalid token" });
  }

  if (err.statusCode) {
    return res.status(err.statusCode).json({ message: err.message });
  }

  if (err.message === "CORS blocked for this origin") {
    return res.status(403).json({ message: "Forbidden: origin not allowed" });
  }

  return res.status(500).json({
    message: "Internal server error",
    error: process.env.NODE_ENV === "production" ? undefined : err.message
  });
};

module.exports = errorHandler;
