const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const FollowUp = sequelize.define(
  "FollowUp",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    lead_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    scheduled_date: {
      type: DataTypes.DATE,
      allowNull: false
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    sequence_step: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    cancelled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    status: {
      type: DataTypes.ENUM("pending", "processing", "completed", "failed"),
      allowNull: false,
      defaultValue: "pending"
    },
    attempt_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    processing_started_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    sent_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    provider_message_id: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    last_error: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  },
  {
    tableName: "followups",
    timestamps: false
  }
);

module.exports = FollowUp;
