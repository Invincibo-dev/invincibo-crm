const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const STATUSES = ["paid_training", "onboarding", "step1", "active", "inactive", "blocked", "at_risk"];

const Student = sequelize.define(
  "Student",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false
    },
    phone: {
      type: DataTypes.STRING(40),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM(...STATUSES),
      allowNull: false,
      defaultValue: "paid_training"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    last_action_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    tableName: "student",
    timestamps: false,
    indexes: [{ fields: ["status"] }, { fields: ["last_action_at"] }]
  }
);

module.exports = Student;
