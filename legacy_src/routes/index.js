const express = require("express");
const authRoutes = require("./authRoutes");
const studentRoutes = require("./studentRoutes");
const actionRoutes = require("./actionRoutes");
const dashboardRoutes = require("./dashboardRoutes");

const router = express.Router();

router.use(authRoutes);
router.use(studentRoutes);
router.use(actionRoutes);
router.use(dashboardRoutes);

module.exports = router;