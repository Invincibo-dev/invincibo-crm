const rateLimit = require("express-rate-limit");

const standardHeaders = true;
const legacyHeaders = false;

const apiLimiter = rateLimit({
  windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.API_RATE_LIMIT_MAX || 600),
  standardHeaders,
  legacyHeaders,
  message: { message: "Too many requests, please retry later" }
});

const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 10),
  standardHeaders,
  legacyHeaders,
  message: { message: "Too many login attempts, please retry later" }
});

module.exports = {
  apiLimiter,
  loginLimiter
};
