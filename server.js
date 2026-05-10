require("dotenv").config();

const app = require("./app");
const { sequelize } = require("./models");

const port = Number(process.env.PORT) || 5000;
const nodeEnv = process.env.NODE_ENV || "development";
const dbAutoSync = process.env.DB_AUTO_SYNC === "true";

const startServer = async () => {
  try {
    await sequelize.authenticate();

    if (dbAutoSync && nodeEnv !== "production") {
      await sequelize.sync();
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
