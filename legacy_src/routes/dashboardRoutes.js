const express = require("express");
const dashboardController = require("../controllers/dashboardController");

const router = express.Router();

router.get("/dashboard/summary", dashboardController.getDashboardSummary);

module.exports = router;