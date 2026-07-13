require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");

const migrationsDirectory = path.join(__dirname, "..", "migrations");

const ensureMigrationTable = () =>
  sequelize.getQueryInterface().createTable("schema_migrations", {
    name: {
      type: require("sequelize").DataTypes.STRING(190),
      primaryKey: true,
      allowNull: false
    },
    applied_at: {
      type: require("sequelize").DataTypes.DATE,
      allowNull: false
    }
  });

const migrationFiles = () =>
  fs
    .readdirSync(migrationsDirectory)
    .filter((file) => /^\d+.*\.js$/.test(file))
    .sort();

const appliedMigrations = async () => {
  const rows = await sequelize.query("SELECT name FROM schema_migrations ORDER BY name", {
    type: QueryTypes.SELECT
  });
  return new Set(rows.map((row) => row.name));
};

const withMigrationLock = async (work) => {
  if (sequelize.getDialect() !== "mysql") return work();
  const [rows] = await sequelize.query(
    "SELECT GET_LOCK('invincibo_crm_migrations', 30) AS acquired"
  );
  if (Number(rows[0]?.acquired) !== 1) throw new Error("Could not acquire database migration lock");
  try {
    return await work();
  } finally {
    await sequelize.query("SELECT RELEASE_LOCK('invincibo_crm_migrations')");
  }
};

const run = async ({ statusOnly = false } = {}) => {
  await sequelize.authenticate();
  await ensureMigrationTable();

  return withMigrationLock(async () => {
    const applied = await appliedMigrations();
    const files = migrationFiles();

    if (statusOnly) {
      return files.map((name) => ({ name, status: applied.has(name) ? "applied" : "pending" }));
    }

    const completed = [];
    for (const name of files) {
      if (applied.has(name)) continue;
      const migration = require(path.join(migrationsDirectory, name));
      await migration.up({ queryInterface: sequelize.getQueryInterface(), sequelize });
      await sequelize
        .getQueryInterface()
        .bulkInsert("schema_migrations", [{ name, applied_at: new Date() }]);
      completed.push(name);
    }
    return completed;
  });
};

if (require.main === module) {
  run({ statusOnly: process.argv.includes("--status") })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      return sequelize.close();
    })
    .catch(async (error) => {
      console.error(error.message);
      await sequelize.close().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = { run };
