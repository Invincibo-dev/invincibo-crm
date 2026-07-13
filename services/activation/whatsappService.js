const https = require("https");
const trackingService = require("./trackingService");

const WHATSAPP_API_BASE = "https://graph.facebook.com/v18.0";

const normalizePhone = (value) => String(value || "").replace(/[^\d]/g, "");

const hasConfig = () =>
  Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

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

const sendMessage = async (to, message) => {
  const phone = normalizePhone(to);
  const bodyText = String(message || "").trim();

  if (!phone || !bodyText) {
    return {
      success: false,
      statusCode: 400,
      error: "Phone and message are required"
    };
  }

  if (!hasConfig()) {
    return {
      success: false,
      statusCode: 500,
      error: "WhatsApp credentials are missing"
    };
  }

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
    path: `/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
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
      error: error.message
    };
  }
};

module.exports = {
  WHATSAPP_API_BASE,
  sendMessage,
  hasConfig,
  attachTrackingLink
};
