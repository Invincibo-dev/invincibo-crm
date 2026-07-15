const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const { FOLLOWUP_STATUSES, META_MESSAGE_STATUSES } = require("../config/whatsappStates");

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
      type: DataTypes.ENUM(...FOLLOWUP_STATUSES),
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
    meta_status: {
      type: DataTypes.ENUM(...META_MESSAGE_STATUSES),
      allowNull: true
    },
    meta_error_code: {
      type: DataTypes.STRING(80),
      allowNull: true
    },
    meta_error_message: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    accepted_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    delivered_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    read_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    failed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    review_reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    reviewed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    reviewed_by: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    review_note: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    recovery_source: {
      type: DataTypes.STRING(40),
      allowNull: true
    },
    delivery_evidence: {
      type: DataTypes.STRING(40),
      allowNull: true
    },
    last_error: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: "followups",
    timestamps: false,
    indexes: [
      {
        name: "idx_followups_processing_review",
        fields: ["status", "processing_started_at"]
      }
    ],
    hooks: {
      beforeSave(followUp) {
        followUp.updated_at = new Date();
      }
    }
  }
);

module.exports = FollowUp;
