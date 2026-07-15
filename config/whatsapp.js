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
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID;
  const graphApiVersion = getGraphApiVersion();

  return {
    token,
    phoneNumberId,
    graphApiVersion,
    endpoint: `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`,
    sendEnabled: isEnabled("WHATSAPP_SEND_ENABLED"),
    allowFreeformMessages: isEnabled("WHATSAPP_ALLOW_FREEFORM_MESSAGES"),
    templateName: String(process.env.WHATSAPP_TEMPLATE_NAME || "").trim(),
    templateLanguage: String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || "").trim()
  };
};

const validateWhatsAppConfig = ({ requireTemplate = false } = {}) => {
  const config = getWhatsAppConfig();
  const { token, phoneNumberId, sendEnabled, templateName, templateLanguage } = config;

  if (!sendEnabled) {
    const error = new Error("WhatsApp sending is disabled by WHATSAPP_SEND_ENABLED");
    error.code = "WHATSAPP_SEND_DISABLED";
    error.noNetworkAttempt = true;
    throw error;
  }

  if (!token || !phoneNumberId) {
    const error = new Error(
      "WhatsApp env vars are missing: WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required"
    );
    error.noNetworkAttempt = true;
    throw error;
  }

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
  validateWhatsAppConfig,
  isWhatsAppSendingEnabled: () => isEnabled("WHATSAPP_SEND_ENABLED")
};
