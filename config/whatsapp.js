const WHATSAPP_BASE_URL = "https://graph.facebook.com/v19.0";

const getWhatsAppConfig = () => {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID;

  return {
    token,
    phoneNumberId,
    endpoint: `${WHATSAPP_BASE_URL}/${phoneNumberId}/messages`
  };
};

const validateWhatsAppConfig = () => {
  const { token, phoneNumberId } = getWhatsAppConfig();

  if (!token || !phoneNumberId) {
    throw new Error("WhatsApp env vars are missing: WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required");
  }
};

module.exports = {
  getWhatsAppConfig,
  validateWhatsAppConfig
};
