const express = require("express");
const trackingController = require("../controllers/trackingController");

const router = express.Router();

router.get("/t/:token", trackingController.handleTrackingRedirect);

module.exports = router;
