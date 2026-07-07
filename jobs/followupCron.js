const cron = require("node-cron");
const { processPendingFollowups } = require("../services/whatsappService");

const startFollowupCron = () => {
  // Marketing automation runner: executes every 5 minutes.
  return cron.schedule("*/5 * * * *", async () => {
    try {
      const result = await processPendingFollowups();
      if (process.env.NODE_ENV !== "test") {
        console.log("[Cron] Follow-up processor result:", result);
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        console.error("[Cron] Follow-up processor error:", error.message);
      }
    }
  });
};

module.exports = {
  startFollowupCron
};
