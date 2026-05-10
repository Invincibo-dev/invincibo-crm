const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const StudentAction = sequelize.define(
  "StudentAction",
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
      type: DataTypes.ENUM("onboarding", "step1", "activation", "support", "message"),
      allowNull: false
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: "student_action",
    timestamps: false,
    indexes: [{ fields: ["student_id"] }, { fields: ["type"] }, { fields: ["created_at"] }]
  }
);

module.exports = StudentAction;
