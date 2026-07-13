process.env.DB_DIALECT = "sqlite";
process.env.DB_STORAGE = ":memory:";

const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");
const { run } = require("../scripts/migrate");

describe("database migrations", () => {
  beforeAll(async () => {
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test("applies pending migrations once and reports their status", async () => {
    const firstRun = await run();
    const secondRun = await run();
    const status = await run({ statusOnly: true });
    const rows = await sequelize.query("SELECT name FROM schema_migrations", {
      type: QueryTypes.SELECT
    });

    expect(firstRun).toContain("20260711_001_query_indexes.js");
    expect(secondRun).toEqual([]);
    expect(status).toEqual([{ name: "20260711_001_query_indexes.js", status: "applied" }]);
    expect(rows).toHaveLength(1);
  });
});
