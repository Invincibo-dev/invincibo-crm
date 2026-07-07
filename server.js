require("dotenv").config();

const app = require("./app");
const { validateProductionConfig } = require("./config/production");
const { startFollowupCron } = require("./jobs/followupCron");
const { sequelize } = require("./models");

const port = Number(process.env.PORT) || 5000;
const nodeEnv = process.env.NODE_ENV || "development";
const dbAutoSync = process.env.DB_AUTO_SYNC === "true";
const followupCronEnabled = process.env.FOLLOWUP_CRON_ENABLED === "true";

const startServer = async () => {
  try {
    validateProductionConfig();
    await sequelize.authenticate();

    if (dbAutoSync && nodeEnv !== "production") {
      await sequelize.sync();
    }

    if (followupCronEnabled) {
      startFollowupCron();
      console.log("Follow-up cron enabled");
    }

    app.listen(port, () => {
      console.log(`CRM API listening on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
