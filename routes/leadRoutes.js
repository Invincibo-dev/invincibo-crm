const express = require("express");
const {
  createLead,
  getLeads,
  getLeadById,
  updateLeadStatus,
  deleteLead,
  cancelLeadSequence
} = require("../controllers/leadController");
const { addTagToLead, getLeadTags, removeTagFromLead } = require("../controllers/tagController");
const { authorizeRoles } = require("../middleware/authMiddleware");
const {
  validateIdParam,
  validateCreateLeadBody,
  validateUpdateLeadStatusBody,
  validateAddTagBody
} = require("../middleware/validators");

const router = express.Router();

router.post("/", authorizeRoles("admin", "agent"), validateCreateLeadBody, createLead);
router.get("/", authorizeRoles("admin", "agent"), getLeads);
router.get("/:id", authorizeRoles("admin", "agent"), validateIdParam("id"), getLeadById);
router.put(
  "/:id/status",
  authorizeRoles("admin", "agent"),
  validateIdParam("id"),
  validateUpdateLeadStatusBody,
  updateLeadStatus
);
router.put("/:id/cancel-sequence", authorizeRoles("admin", "agent"), validateIdParam("id"), cancelLeadSequence);
router.post("/:id/tags", authorizeRoles("admin", "agent"), validateIdParam("id"), validateAddTagBody, addTagToLead);
router.get("/:id/tags", authorizeRoles("admin", "agent"), validateIdParam("id"), getLeadTags);
router.delete("/:leadId/tags/:tagId", authorizeRoles("admin", "agent"), validateIdParam("leadId"), validateIdParam("tagId"), removeTagFromLead);
router.delete("/:id", authorizeRoles("admin"), validateIdParam("id"), deleteLead);

module.exports = router;
