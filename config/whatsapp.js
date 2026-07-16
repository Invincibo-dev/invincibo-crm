const DEFAULT_GRAPH_API_VERSION = "v23.0";

const isEnabled = (name) => process.env[name] === "true";

const getGraphApiVersion = () => {
  const version = String(
    process.env.WHATSAPP_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION
  ).trim();
  if (!/^v\d+\.\d+$/.test(version)) {
    throw new Error("WHATSAPP_GRAPH_API_VERSION must look like v23.0");
  }
  return version;
};

const getWhatsAppConfig = () => {
  const token = String(
    process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || ""
  ).trim();
  const wabaId = String(process.env.WHATSAPP_WABA_ID || "").trim();
  const phoneNumberId = String(
    process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || ""
  ).trim();
  const graphApiVersion = getGraphApiVersion();

  return {
    token,
    wabaId,
    phoneNumberId,
    graphApiVersion,
    endpoint: `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`,
    sendEnabled: isEnabled("WHATSAPP_SEND_ENABLED"),
    allowFreeformMessages: isEnabled("WHATSAPP_ALLOW_FREEFORM_MESSAGES"),
    templateName: String(process.env.WHATSAPP_TEMPLATE_NAME || "").trim(),
    templateLanguage: String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || "").trim()
  };
};

const validateWhatsAppMetaIdentifiers = (config = getWhatsAppConfig()) => {
  const { wabaId, phoneNumberId } = config;

  if (!wabaId || !phoneNumberId) {
    const error = new Error(
      "WhatsApp Meta identifiers are missing: WHATSAPP_WABA_ID and WHATSAPP_PHONE_NUMBER_ID are required"
    );
    error.code = "WHATSAPP_META_IDENTIFIERS_MISSING";
    error.noNetworkAttempt = true;
    throw error;
  }

  if (!/^\d+$/.test(wabaId) || !/^\d+$/.test(phoneNumberId)) {
    const error = new Error("WhatsApp Meta identifiers must contain digits only");
    error.code = "WHATSAPP_META_IDENTIFIERS_INVALID";
    error.noNetworkAttempt = true;
    throw error;
  }

  if (wabaId === phoneNumberId) {
    const error = new Error(
      "WHATSAPP_WABA_ID and WHATSAPP_PHONE_NUMBER_ID must identify different Meta objects"
    );
    error.code = "WHATSAPP_META_IDENTIFIERS_COLLISION";
    error.noNetworkAttempt = true;
    throw error;
  }

  return config;
};

const validateWhatsAppConfig = ({ requireTemplate = false } = {}) => {
  const config = getWhatsAppConfig();
  const { token, sendEnabled, templateName, templateLanguage } = config;

  if (!sendEnabled) {
    const error = new Error("WhatsApp sending is disabled by WHATSAPP_SEND_ENABLED");
    error.code = "WHATSAPP_SEND_DISABLED";
    error.noNetworkAttempt = true;
    throw error;
  }

  if (!token) {
    const error = new Error("WhatsApp env var is missing: WHATSAPP_ACCESS_TOKEN is required");
    error.noNetworkAttempt = true;
    throw error;
  }

  validateWhatsAppMetaIdentifiers(config);

  if (requireTemplate && (!templateName || !templateLanguage)) {
    const error = new Error(
      "WhatsApp template env vars are missing: WHATSAPP_TEMPLATE_NAME and WHATSAPP_TEMPLATE_LANGUAGE are required"
    );
    error.noNetworkAttempt = true;
    throw error;
  }

  return config;
};

module.exports = {
  DEFAULT_GRAPH_API_VERSION,
  getWhatsAppConfig,
  validateWhatsAppMetaIdentifiers,
  validateWhatsAppConfig,
  isWhatsAppSendingEnabled: () => isEnabled("WHATSAPP_SEND_ENABLED")
};
