const {
  recordVerifiedWebhook,
  verifyChallengeToken,
  verifyMetaSignature
} = require("../services/whatsappWebhookService");
const { processWebhookStatuses } = require("../services/whatsappStatusService");
const { processInboundMessages } = require("../services/whatsappInboundService");

const verifyWebhook = (req, res, next) => {
  try {
    const mode = req.query["hub.mode"];
    const verifyToken = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (!mode || !verifyToken || challenge === undefined || challenge === "") {
      return res.status(400).json({ message: "Missing webhook verification parameters" });
    }
    if (mode !== "subscribe" || !verifyChallengeToken(verifyToken)) {
      return res.status(403).json({ message: "Webhook verification rejected" });
    }
    return res.status(200).send(String(challenge));
  } catch (error) {
    return next(error);
  }
};

const receiveWebhook = async (req, res, next) => {
  try {
    verifyMetaSignature(req.rawBody, req.get("x-hub-signature-256"));
    const { event } = await recordVerifiedWebhook({ payload: req.body, rawBody: req.rawBody });
    await processWebhookStatuses({ event, payload: req.body });
    await processInboundMessages({ event, payload: req.body });
    return res.status(200).json({ received: true });
  } catch (error) {
    return next(error);
  }
};

module.exports = { verifyWebhook, receiveWebhook };
