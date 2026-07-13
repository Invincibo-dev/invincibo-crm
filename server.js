require("dotenv").config();

const app = require("./app");
const { validateProductionConfig } = require("./config/production");
const { startFollowupCron } = require("./jobs/followupCron");
const { sequelize } = require("./models");
const runtimeState = require("./config/runtimeState");

const port = Number(process.env.PORT) || 5000;
const nodeEnv = process.env.NODE_ENV || "development";
const dbAutoSync = process.env.DB_AUTO_SYNC === "true";
const followupCronEnabled = process.env.FOLLOWUP_CRON_ENABLED === "true";

const initializeRuntime = async () => {
  runtimeState.markNotReady();
  await sequelize.authenticate();

  if (dbAutoSync && nodeEnv !== "production") {
    await sequelize.sync();
  }

  if (followupCronEnabled) {
    startFollowupCron();
    console.log("Follow-up cron enabled");
  }
  runtimeState.markReady();
};

const startServer = () => {
  validateProductionConfig();
  runtimeState.markNotReady();
  const server = app.listen(port, () => {
    console.log(`CRM API listening on port ${port}; initialization in progress`);
  });
  const ready = initializeRuntime();
  return { server, ready };
};

const launch = () => {
  try {
    const { server, ready } = startServer();
    ready
      .then(() => console.log("CRM API is ready"))
      .catch((error) => {
        runtimeState.markNotReady();
        console.error("Failed to initialize runtime:", error.message);
        server.close(() => process.exit(1));
        setTimeout(() => process.exit(1), 1000).unref();
      });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    runtimeState.markNotReady();
    process.exit(1);
  }
};

// Hostinger loads the entry file through a wrapper, so require.main guards do
// not work there. Tests opt out through NODE_ENV instead.
if (process.env.NODE_ENV !== "test") {
  launch();
}

module.exports = { initializeRuntime, startServer, launch };
