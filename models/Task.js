const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Task = sequelize.define(
  "Task",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    student_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM(
        "onboarding_issue",
        "payment_issue",
        "server_activation_issue",
        "motivation_issue",
        "technical_issue"
      ),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM("pending", "in_progress", "resolved"),
      allowNull: false,
      defaultValue: "pending"
    },
    priority: {
      type: DataTypes.ENUM("urgent", "normal", "low"),
      allowNull: false,
      defaultValue: "normal"
    },
    assigned_to: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    resolved_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    tableName: "tasks",
    timestamps: false,
    indexes: [
      { fields: ["student_id"] },
      { fields: ["type"] },
      { fields: ["status"] },
      { fields: ["priority"] },
      { fields: ["assigned_to"] }
    ]
  }
);

module.exports = Task;
