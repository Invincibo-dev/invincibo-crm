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
    expect(firstRun).toContain("20260714_001_whatsapp_consent.js");
    expect(firstRun).toContain("20260714_002_whatsapp_tracking_schema.js");
    expect(firstRun).toContain("20260714_003_whatsapp_webhook_receipt.js");
    expect(firstRun).toContain("20260714_004_whatsapp_status_processing.js");
    expect(firstRun).toContain("20260714_005_whatsapp_inbound_consent.js");
    expect(firstRun).toContain("20260715_006_followup_recovery.js");
    expect(firstRun).toContain("20260715_007_message_delivery_evidence.js");
    expect(secondRun).toEqual([]);
    expect(status).toEqual([
      { name: "20260711_001_query_indexes.js", status: "applied" },
      { name: "20260714_001_whatsapp_consent.js", status: "applied" },
      { name: "20260714_002_whatsapp_tracking_schema.js", status: "applied" },
      { name: "20260714_003_whatsapp_webhook_receipt.js", status: "applied" },
      { name: "20260714_004_whatsapp_status_processing.js", status: "applied" },
      { name: "20260714_005_whatsapp_inbound_consent.js", status: "applied" },
      { name: "20260715_006_followup_recovery.js", status: "applied" },
      { name: "20260715_007_message_delivery_evidence.js", status: "applied" }
    ]);
    expect(rows).toHaveLength(8);
  });
});
