const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: toNumber(process.env.PORT, 5000),
  dbDialect: process.env.DB_DIALECT || "mysql",
  dbAutoSync: process.env.DB_AUTO_SYNC === "true",
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: toNumber(process.env.DB_PORT, 3306),
    name: process.env.DB_NAME || "activation_engine",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    storage: process.env.DB_STORAGE || "./dev.sqlite"
  }
};

if (config.nodeEnv === "production" && config.dbDialect === "mysql") {
  const required = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

module.exports = { config };