const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const leadRoutes = require("./routes/leadRoutes");
const followupRoutes = require("./routes/followupRoutes");
const tagRoutes = require("./routes/tagRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const activationRoutes = require("./routes/activationRoutes");
const trackingRoutes = require("./routes/trackingRoutes");
const { authenticateToken } = require("./middleware/authMiddleware");
const { apiLimiter } = require("./middleware/rateLimiters");
const errorHandler = require("./middleware/errorHandler");

const app = express();
app.set("trust proxy", 1);

const defaultCorsOrigin = process.env.NODE_ENV === "production" ? "https://cv-pam.com" : "http://localhost:5173";
const allowedOrigins = (process.env.CORS_ORIGIN || defaultCorsOrigin)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests and same-origin requests with no Origin header.
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS blocked for this origin"));
    }
  })
);

app.use(express.json());
app.use("/api", apiLimiter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(trackingRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/leads", authenticateToken, leadRoutes);
app.use("/api/followups", authenticateToken, followupRoutes);
app.use("/api/tags", authenticateToken, tagRoutes);
app.use("/api/dashboard", authenticateToken, dashboardRoutes);
app.use("/api/activation", authenticateToken, activationRoutes);

app.use("/api", (_req, res) => {
  res.status(404).json({ message: "API route not found" });
});

app.use(errorHandler);

module.exports = app;
