require("dotenv").config();

const assertStagingOnly = () => {
  const database = String(process.env.DB_NAME || "").trim();
  if (process.env.NODE_ENV !== "staging" || process.env.DB_DIALECT !== "mysql") {
    throw new Error("MySQL staging report requires NODE_ENV=staging and DB_DIALECT=mysql");
  }
  if (process.env.MYSQL_STAGING_CONFIRM !== "STAGING_ONLY") {
    throw new Error("Set MYSQL_STAGING_CONFIRM=STAGING_ONLY after verifying the target database");
  }
  if (!/(staging|stage|test)/i.test(database)) {
    throw new Error(
      "Refusing database whose name does not explicitly contain staging, stage, or test"
    );
  }
};

const run = async () => {
  assertStagingOnly();
  const { QueryTypes } = require("sequelize");
  const { sequelize } = require("../models");
  try {
    await sequelize.authenticate();
    const [database] = await sequelize.query("SELECT DATABASE() AS name", {
      type: QueryTypes.SELECT
    });
    const migrations = await sequelize.query(
      "SELECT name, applied_at FROM schema_migrations ORDER BY name",
      { type: QueryTypes.SELECT }
    );
    const columns = await sequelize.query(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('followups', 'messages', 'whatsapp_webhook_events')
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      { type: QueryTypes.SELECT }
    );
    const indexes = await sequelize.query(
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE,
              GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_list
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('followups', 'messages', 'whatsapp_webhook_events')
        GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
        ORDER BY TABLE_NAME, INDEX_NAME`,
      { type: QueryTypes.SELECT }
    );
    const foreignKeys = await sequelize.query(
      `SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME
         FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME, CONSTRAINT_NAME`,
      { type: QueryTypes.SELECT }
    );
    console.log(
      JSON.stringify(
        { database: database.name, migrations, columns, indexes, foreignKeys },
        null,
        2
      )
    );
  } finally {
    await sequelize.close();
  }
};

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
