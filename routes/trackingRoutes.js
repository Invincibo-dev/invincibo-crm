const express = require("express");
const trackingService = require("../services/activation/trackingService");

const router = express.Router();

router.get("/t/:token", async (req, res, next) => {
  try {
    const { destination } = await trackingService.handleTrackingToken(req.params.token);
    return res.redirect(302, destination);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
