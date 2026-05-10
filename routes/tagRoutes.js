const express = require("express");
const { createTag, getTags } = require("../controllers/tagController");
const { authorizeRoles } = require("../middleware/authMiddleware");
const { validateCreateTagBody } = require("../middleware/validators");

const router = express.Router();

router.post("/", authorizeRoles("admin"), validateCreateTagBody, createTag);
router.get("/", authorizeRoles("admin", "agent"), getTags);

module.exports = router;
