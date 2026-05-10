const express = require("express");
const { register, login, me, listUsers } = require("../controllers/authController");
const { authenticateToken, optionalAuth, authorizeRoles } = require("../middleware/authMiddleware");
const { validateRegisterBody, validateLoginBody } = require("../middleware/validators");
const { loginLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.post("/register", optionalAuth, validateRegisterBody, register);
router.post("/login", loginLimiter, validateLoginBody, login);
router.get("/me", authenticateToken, me);
router.get("/users", authenticateToken, authorizeRoles("admin"), listUsers);

module.exports = router;
