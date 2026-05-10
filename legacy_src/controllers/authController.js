const { User } = require("../models");
const { AppError } = require("../services/errors");

const normalize = (value) => String(value || "").trim();

const login = async (req, res, next) => {
  try {
    const phone = normalize(req.body?.phone);
    if (!phone) {
      throw new AppError("phone is required", 400);
    }

    const user = await User.findOne({
      where: { phone },
      attributes: ["id", "name", "phone", "role"]
    });

    if (!user) {
      throw new AppError("Invalid credentials", 401);
    }

    return res.json({ user });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  login
};