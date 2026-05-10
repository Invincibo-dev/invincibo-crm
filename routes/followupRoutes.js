const express = require("express");
const {
  createFollowUp,
  getPendingFollowUps,
  processFollowups
} = require("../controllers/followupController");
const { authorizeRoles } = require("../middleware/authMiddleware");
const { validateCreateFollowupBody } = require("../middleware/validators");

const router = express.Router();

router.post("/", authorizeRoles("admin", "agent"), validateCreateFollowupBody, createFollowUp);
router.post("/process", authorizeRoles("admin"), processFollowups);
router.get("/pending", authorizeRoles("admin", "agent"), getPendingFollowUps);

module.exports = router;
