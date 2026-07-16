const webhookSignatureDiagnostics = (req) => {
  const signatureHeader = String(req.get?.("x-hub-signature-256") || "");
  return {
    signature_header_present: Boolean(signatureHeader),
    signature_header_format_valid: /^sha256=[a-f0-9]{64}$/i.test(signatureHeader),
    raw_body_present: Buffer.isBuffer(req.rawBody),
    raw_body_bytes: Buffer.isBuffer(req.rawBody) ? req.rawBody.length : 0
  };
};

const errorHandler = (err, req, res, _next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body too large" });
  }
  if (err.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({ message: "Duplicate value detected" });
  }

  if (err.name === "SequelizeValidationError") {
    return res.status(400).json({ message: err.errors[0]?.message || "Invalid data" });
  }

  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return res.status(401).json({ message: "Unauthorized: invalid token" });
  }

  if (err.statusCode) {
    const requestPath = String(req.originalUrl || "").split("?", 1)[0];
    if (
      process.env.NODE_ENV === "production" &&
      requestPath === "/api/webhooks/whatsapp" &&
      err.statusCode === 401 &&
      err.message === "Invalid WhatsApp webhook signature"
    ) {
      console.warn("[WhatsApp Webhook] Signature rejected", webhookSignatureDiagnostics(req));
    }
    return res.status(err.statusCode).json({ message: err.message });
  }

  if (err.message === "CORS blocked for this origin") {
    return res.status(403).json({ message: "Forbidden: origin not allowed" });
  }

  return res.status(500).json({
    message: "Internal server error",
    error: process.env.NODE_ENV === "production" ? undefined : err.message
  });
};

module.exports = errorHandler;
module.exports.webhookSignatureDiagnostics = webhookSignatureDiagnostics;
