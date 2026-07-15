const express = require("express");
const {
  createFollowUp,
  getPendingFollowUps,
  getReviewFollowUps,
  processFollowups,
  reviewFollowUpDecision,
  runFollowUpRecovery
} = require("../controllers/followupController");
const { authorizeRoles } = require("../middleware/authMiddleware");
const { validateCreateFollowupBody } = require("../middleware/validators");

const router = express.Router();

router.post("/", authorizeRoles("admin", "agent"), validateCreateFollowupBody, createFollowUp);
router.post("/process", authorizeRoles("admin"), processFollowups);
router.get("/review", authorizeRoles("admin"), getReviewFollowUps);
router.post("/recovery/run", authorizeRoles("admin"), runFollowUpRecovery);
router.patch("/:id/review", authorizeRoles("admin"), reviewFollowUpDecision);
router.get("/pending", authorizeRoles("admin", "agent"), getPendingFollowUps);

module.exports = router;
