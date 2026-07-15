const https = require("https");
const {
  DEFAULT_GRAPH_API_VERSION,
  getWhatsAppConfig,
  isWhatsAppSendingEnabled
} = require("../../config/whatsapp");
const trackingService = require("./trackingService");
const { canSendWhatsApp } = require("../whatsappConsentService");
const { normalizeWhatsAppPhone } = require("../whatsappPhoneService");

const WHATSAPP_API_BASE = `https://graph.facebook.com/${DEFAULT_GRAPH_API_VERSION}`;

const normalizePhone = normalizeWhatsAppPhone;

const hasConfig = () => {
  const { token, phoneNumberId, sendEnabled, allowFreeformMessages } = getWhatsAppConfig();
  return Boolean(token && phoneNumberId && sendEnabled && allowFreeformMessages);
};

const attachTrackingLink = ({ studentId, trackingType, message }) => {
  const bodyText = String(message || "").trim();

  if (!studentId || !trackingType) {
    return bodyText;
  }

  const trackingLink = trackingService.generateTrackingLink(studentId, trackingType);

  if (bodyText.includes("[lien]")) {
    return bodyText.replaceAll("[lien]", trackingLink);
  }

  return `${bodyText} ${trackingLink}`.trim();
};

const sendMessage = async (contact, message, messageCategory = "utility") => {
  const policy = canSendWhatsApp(contact, messageCategory);
  if (!policy.allowed) {
    return { success: false, skipped: true, status: "skipped_opt_out", statusCode: 0 };
  }
  const phone = normalizePhone(contact.phone);
  const bodyText = String(message || "").trim();

  if (!phone || !bodyText) {
    return {
      success: false,
      statusCode: 400,
      error: "Phone and message are required"
    };
  }

  if (!isWhatsAppSendingEnabled()) {
    return {
      success: false,
      statusCode: 0,
      error: "WhatsApp sending is disabled by WHATSAPP_SEND_ENABLED",
      code: "WHATSAPP_SEND_DISABLED",
      noNetworkAttempt: true
    };
  }

  if (process.env.NODE_ENV === "test") {
    return {
      success: true,
      statusCode: 200,
      mock: true,
      data: { messages: [{ id: `wamid.test.${Date.now()}.${Math.random()}` }] }
    };
  }

  if (!hasConfig()) {
    return {
      success: false,
      statusCode: 500,
      error: "WhatsApp credentials are missing",
      noNetworkAttempt: true
    };
  }

  const { token, phoneNumberId, graphApiVersion } = getWhatsAppConfig();
  const payload = JSON.stringify({
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: {
      body: bodyText
    }
  });

  const options = {
    method: "POST",
    hostname: "graph.facebook.com",
    path: `/${graphApiVersion}/${phoneNumberId}/messages`,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    },
    timeout: 12000
  };

  try {
    const response = await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let data;
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch (_error) {
            data = { raw };
          }

          resolve({
            statusCode: res.statusCode || 500,
            data
          });
        });
      });

      req.on("timeout", () => {
        req.destroy(new Error("WhatsApp request timeout"));
      });

      req.on("error", reject);
      req.write(payload);
      req.end();
    });

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return {
        success: true,
        statusCode: response.statusCode,
        data: response.data
      };
    }

    if (process.env.NODE_ENV === "production") {
      console.error("[Activation WhatsApp] API error", response.statusCode);
    } else {
      console.error("[Activation WhatsApp] API error", {
        statusCode: response.statusCode,
        data: response.data
      });
    }

    return {
      success: false,
      statusCode: response.statusCode,
      error: response.data?.error?.message || "WhatsApp API error",
      data: response.data
    };
  } catch (error) {
    console.error("[Activation WhatsApp] sendMessage failed", error.message);
    return {
      success: false,
      statusCode: 500,
      error: error.message,
      deliveryAmbiguous: true
    };
  }
};

module.exports = {
  WHATSAPP_API_BASE,
  sendMessage,
  hasConfig,
  attachTrackingLink
};
