const PLACEHOLDER_PATTERNS = [
  /^replace_/i,
  /^your_/i,
  /^<.*>$/,
  /change_me/i
];

const isBlank = (value) => !String(value || "").trim();

const isPlaceholder = (value) => {
  const normalized = String(value || "").trim();
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
};

const requireProductionValue = (name, missing) => {
  const value = process.env[name];
  if (isBlank(value) || isPlaceholder(value)) {
    missing.push(name);
  }
};

const validateProductionConfig = () => {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const missing = [];

  [
    "CORS_ORIGIN",
    "JWT_SECRET",
    "TRACKING_BASE_URL",
    "TRACKING_SECRET",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID"
  ].forEach((name) => requireProductionValue(name, missing));

  const dialect = process.env.DB_DIALECT || "mysql";
  if (dialect !== "mysql") {
    throw new Error("Production DB_DIALECT must be mysql");
  }

  ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"].forEach((name) =>
    requireProductionValue(name, missing)
  );

  if (process.env.DB_AUTO_SYNC === "true") {
    throw new Error("DB_AUTO_SYNC must be false or unset in production");
  }

  if (process.env.CORS_ORIGIN === "*") {
    throw new Error("CORS_ORIGIN cannot be '*' in production");
  }

  if (missing.length > 0) {
    throw new Error(`Missing or placeholder production env vars: ${missing.join(", ")}`);
  }
};

module.exports = {
  validateProductionConfig
};
