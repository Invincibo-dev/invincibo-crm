const express = require("express");
const groupController = require("../controllers/groupController");
const { authorizeRoles } = require("../middleware/authMiddleware");
const { validateIdParam } = require("../middleware/validators");

const router = express.Router();

router.get("/", authorizeRoles("admin", "agent"), groupController.listGroups);
router.post("/", authorizeRoles("admin", "agent"), groupController.createGroup);
router.get(
  "/:id",
  authorizeRoles("admin", "agent"),
  validateIdParam("id"),
  groupController.getGroup
);
router.patch(
  "/:id",
  authorizeRoles("admin", "agent"),
  validateIdParam("id"),
  groupController.updateGroup
);
router.delete("/:id", authorizeRoles("admin"), validateIdParam("id"), groupController.deleteGroup);

router.get(
  "/:id/members",
  authorizeRoles("admin", "agent"),
  validateIdParam("id"),
  groupController.listMembers
);
router.post(
  "/:id/members",
  authorizeRoles("admin", "agent"),
  validateIdParam("id"),
  groupController.addMember
);
router.patch(
  "/:id/members/:memberId",
  authorizeRoles("admin", "agent"),
  validateIdParam("id"),
  validateIdParam("memberId"),
  groupController.updateMember
);
router.delete(
  "/:id/members/:memberId",
  authorizeRoles("admin", "agent"),
  validateIdParam("id"),
  validateIdParam("memberId"),
  groupController.removeMember
);

router.post(
  "/:id/import-csv",
  authorizeRoles("admin", "agent"),
  validateIdParam("id"),
  groupController.importCsv
);
router.post(
  "/:id/send-message",
  authorizeRoles("admin", "agent"),
  validateIdParam("id"),
  groupController.sendMessage
);

module.exports = router;
