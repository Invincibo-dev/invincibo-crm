const express = require("express");
const { getDashboardStats } = require("../controllers/dashboardController");
const { authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/stats", authorizeRoles("admin", "agent"), getDashboardStats);

module.exports = router;
