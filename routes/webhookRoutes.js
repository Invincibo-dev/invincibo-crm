const express = require("express");
const { receiveWebhook, verifyWebhook } = require("../controllers/whatsappWebhookController");

const router = express.Router();

router.get("/", verifyWebhook);
router.post("/", receiveWebhook);

module.exports = router;
