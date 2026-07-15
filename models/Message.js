const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const {
  MESSAGE_DIRECTIONS,
  MESSAGE_STATUSES,
  MESSAGE_TYPES,
  META_MESSAGE_STATUSES
} = require("../config/whatsappStates");

const Message = sequelize.define(
  "Message",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    lead_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    student_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    followup_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      unique: true
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM(...MESSAGE_TYPES),
      allowNull: false,
      defaultValue: "initial"
    },
    direction: {
      type: DataTypes.ENUM(...MESSAGE_DIRECTIONS),
      allowNull: false,
      defaultValue: "outbound"
    },
    status: {
      type: DataTypes.ENUM(...MESSAGE_STATUSES),
      allowNull: false,
      defaultValue: "pending"
    },
    template_name: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    template_language: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    template_parameters_json: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    meta_message_id: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    delivery_evidence: {
      type: DataTypes.STRING(40),
      allowNull: true
    },
    source_phone: {
      type: DataTypes.STRING(15),
      allowNull: true
    },
    source: {
      type: DataTypes.STRING(30),
      allowNull: true
    },
    inbound_message_type: {
      type: DataTypes.STRING(30),
      allowNull: true
    },
    context_message_id: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    webhook_event_id: {
      type: DataTypes.INTEGER,
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
    sent_at: {
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
    received_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: "messages",
    timestamps: false,
    indexes: [
      { name: "idx_messages_student_history", fields: ["student_id", "created_at"] },
      { name: "uq_messages_meta_message_id", unique: true, fields: ["meta_message_id"] },
      { name: "idx_messages_webhook_event", fields: ["webhook_event_id"] },
      { name: "idx_messages_source_phone", fields: ["source_phone", "received_at"] }
    ],
    validate: {
      exactlyOneContact() {
        const contactCount = Number(Boolean(this.lead_id)) + Number(Boolean(this.student_id));
        if (contactCount > 1 || (this.direction !== "inbound" && contactCount !== 1)) {
          throw new Error(
            "An outbound WhatsApp message requires exactly one contact; inbound allows at most one"
          );
        }
      }
    }
  }
);

module.exports = Message;
