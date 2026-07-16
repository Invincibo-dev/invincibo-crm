const ORIGINAL_ENV = { ...process.env };

const restoreEnvironment = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
};

const setValidProductionEnvironment = () => {
  Object.assign(process.env, {
    NODE_ENV: "production",
    CORS_ORIGIN: "https://example.test",
    JWT_SECRET: "test-jwt-secret",
    TRACKING_BASE_URL: "https://api.example.test",
    TRACKING_SECRET: "test-tracking-secret",
    DB_DIALECT: "mysql",
    DB_HOST: "test-db-host",
    DB_NAME: "test-db-name",
    DB_USER: "test-db-user",
    DB_PASSWORD: "test-db-password",
    DB_AUTO_SYNC: "false",
    WHATSAPP_SEND_ENABLED: "false",
    FOLLOWUP_CRON_ENABLED: "false",
    WHATSAPP_WABA_ID: "111111111111111",
    WHATSAPP_PHONE_NUMBER_ID: "222222222222222"
  });
};

describe("WhatsApp Meta identifier configuration", () => {
  afterEach(() => {
    restoreEnvironment();
    jest.resetModules();
  });

  test("keeps the WABA ID separate and targets messages with the Phone Number ID", () => {
    process.env.WHATSAPP_WABA_ID = "111111111111111";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "222222222222222";
    process.env.WHATSAPP_GRAPH_API_VERSION = "v23.0";

    const { getWhatsAppConfig, validateWhatsAppMetaIdentifiers } = require("../config/whatsapp");
    const config = validateWhatsAppMetaIdentifiers(getWhatsAppConfig());

    expect(config.wabaId).toBe("111111111111111");
    expect(config.phoneNumberId).toBe("222222222222222");
    expect(config.endpoint).toBe("https://graph.facebook.com/v23.0/222222222222222/messages");
  });

  test("rejects a WABA ID reused as the Phone Number ID before any network attempt", () => {
    process.env.WHATSAPP_WABA_ID = "111111111111111";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "111111111111111";

    const { validateWhatsAppMetaIdentifiers } = require("../config/whatsapp");

    expect(() => validateWhatsAppMetaIdentifiers()).toThrow(
      "WHATSAPP_WABA_ID and WHATSAPP_PHONE_NUMBER_ID must identify different Meta objects"
    );

    try {
      validateWhatsAppMetaIdentifiers();
    } catch (error) {
      expect(error.code).toBe("WHATSAPP_META_IDENTIFIERS_COLLISION");
      expect(error.noNetworkAttempt).toBe(true);
    }
  });

  test("requires both identifiers and accepts digits only", () => {
    process.env.WHATSAPP_WABA_ID = "";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "222222222222222";

    const { validateWhatsAppMetaIdentifiers } = require("../config/whatsapp");

    expect(() => validateWhatsAppMetaIdentifiers()).toThrow(
      "WHATSAPP_WABA_ID and WHATSAPP_PHONE_NUMBER_ID are required"
    );

    process.env.WHATSAPP_WABA_ID = "waba-111";
    expect(() => validateWhatsAppMetaIdentifiers()).toThrow(
      "WhatsApp Meta identifiers must contain digits only"
    );
  });
});

describe("production WhatsApp Meta identifier guard", () => {
  afterEach(() => {
    restoreEnvironment();
    jest.resetModules();
  });

  test("accepts distinct WABA and Phone Number identifiers while sending remains disabled", () => {
    setValidProductionEnvironment();
    const { validateProductionConfig } = require("../config/production");

    expect(() => validateProductionConfig()).not.toThrow();
  });

  test("rejects a missing WABA ID even while sending remains disabled", () => {
    setValidProductionEnvironment();
    delete process.env.WHATSAPP_WABA_ID;
    const { validateProductionConfig } = require("../config/production");

    expect(() => validateProductionConfig()).toThrow("WHATSAPP_WABA_ID");
  });

  test("rejects identical identifiers before server startup", () => {
    setValidProductionEnvironment();
    process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_WABA_ID;
    const { validateProductionConfig } = require("../config/production");

    expect(() => validateProductionConfig()).toThrow(
      "WHATSAPP_WABA_ID and WHATSAPP_PHONE_NUMBER_ID must identify different Meta objects"
    );
  });
});
