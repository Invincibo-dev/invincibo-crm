const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { User, BootstrapLock, sequelize } = require("../models");
const { recordAudit } = require("../services/auditService");

const ALLOWED_ROLES = ["admin", "agent"];

const signToken = (user) =>
  jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );

const ensureJwtSecret = () => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing");
  }
};

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return (
    leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const requireBootstrapToken = (providedToken) => {
  const configuredToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!configuredToken || !safeEqual(providedToken, configuredToken)) {
    const error = new Error("Invalid or missing admin bootstrap token");
    error.statusCode = 403;
    throw error;
  }
};

const register = async (req, res, next) => {
  try {
    ensureJwtSecret();

    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "");
    const requestedRole = String(req.body.role || "agent").toLowerCase();

    if (!name || !email || !password) {
      return res.status(400).json({ message: "name, email and password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }
    if (!ALLOWED_ROLES.includes(requestedRole)) {
      return res.status(400).json({ message: "Invalid role value" });
    }

    const totalUsers = await User.count();
    const isBootstrap = totalUsers === 0;
    if (isBootstrap) {
      requireBootstrapToken(req.get("x-admin-bootstrap-token"));
      if (requestedRole !== "admin") {
        return res.status(400).json({ message: "The bootstrap user must be an admin" });
      }
    } else if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ message: "Only admin can create users" });
    }

    const password_hash = await bcrypt.hash(password, 10);
    let user;
    try {
      user = await sequelize.transaction(async (transaction) => {
        const existingUser = await User.findOne({ where: { email }, transaction });
        if (existingUser) {
          const error = new Error("Email already exists");
          error.statusCode = 409;
          throw error;
        }

        if (isBootstrap) {
          const usersInsideTransaction = await User.count({ transaction });
          if (usersInsideTransaction > 0) {
            const error = new Error("Admin bootstrap has already been completed");
            error.statusCode = 409;
            throw error;
          }
          await BootstrapLock.create({ key: "initial_admin" }, { transaction });
        }

        return User.create({ name, email, password_hash, role: requestedRole }, { transaction });
      });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError" && isBootstrap) {
        error.statusCode = 409;
        error.message = "Admin bootstrap has already been completed";
      }
      throw error;
    }

    const token = signToken(user);
    await recordAudit(req, {
      action: "USER_REGISTERED",
      entity: "user",
      entityId: user.id,
      meta: { email: user.email, role: user.role }
    });

    return res.status(201).json({
      message: "User created successfully",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    return next(error);
  }
};

const login = async (req, res, next) => {
  try {
    ensureJwtSecret();

    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = signToken(user);
    await recordAudit(req, {
      action: "USER_LOGGED_IN",
      entity: "user",
      entityId: user.id,
      meta: { email: user.email, role: user.role }
    });
    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    return next(error);
  }
};

const me = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ["id", "name", "email", "role", "created_at"]
    });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.json(user);
  } catch (error) {
    return next(error);
  }
};

const listUsers = async (_req, res, next) => {
  try {
    const users = await User.findAll({
      attributes: ["id", "name", "email", "role", "created_at"],
      order: [["created_at", "DESC"]]
    });
    return res.json(users);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  register,
  login,
  me,
  listUsers
};
