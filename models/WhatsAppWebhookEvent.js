const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const { WEBHOOK_EVENT_STATES, WEBHOOK_EVENT_TYPES } = require("../config/whatsappStates");
const webhookPayloadType =
  sequelize.getDialect() === "mysql" ? DataTypes.TEXT("long") : DataTypes.TEXT;

const WhatsAppWebhookEvent = sequelize.define(
  "WhatsAppWebhookEvent",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    event_key: { type: DataTypes.STRING(255), allowNull: false },
    event_type: { type: DataTypes.ENUM(...WEBHOOK_EVENT_TYPES), allowNull: false },
    meta_message_id: { type: DataTypes.STRING(255), allowNull: true },
    payload_json: { type: webhookPayloadType, allowNull: false },
    state: {
      type: DataTypes.ENUM(...WEBHOOK_EVENT_STATES),
      allowNull: false,
      defaultValue: "received"
    },
    signature_verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    statuses_found: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    processed_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    ignored_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    unmatched_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    failed_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    processed_status_keys_json: { type: DataTypes.TEXT, allowNull: true },
    processing_summary_json: { type: DataTypes.TEXT, allowNull: true },
    messages_found: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    messages_matched: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    messages_unmatched: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    messages_opt_out: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    messages_ignored: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    messages_failed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    processed_message_keys_json: { type: DataTypes.TEXT, allowNull: true },
    received_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    processed_at: { type: DataTypes.DATE, allowNull: true },
    processing_error: { type: DataTypes.TEXT, allowNull: true }
  },
  {
    tableName: "whatsapp_webhook_events",
    timestamps: false,
    indexes: [
      { name: "uq_whatsapp_webhook_event_key", unique: true, fields: ["event_key"] },
      { name: "idx_whatsapp_webhook_meta_message", fields: ["meta_message_id"] },
      { name: "idx_whatsapp_webhook_type_received", fields: ["event_type", "received_at"] }
    ]
  }
);

module.exports = WhatsAppWebhookEvent;
