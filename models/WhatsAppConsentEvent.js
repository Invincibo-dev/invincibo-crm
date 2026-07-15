const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const { CONSENT_ACTIONS, CONSENT_CONTACT_TYPES } = require("../config/whatsappStates");

const WhatsAppConsentEvent = sequelize.define(
  "WhatsAppConsentEvent",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    contact_type: {
      type: DataTypes.ENUM(...CONSENT_CONTACT_TYPES),
      allowNull: false
    },
    contact_id: { type: DataTypes.INTEGER, allowNull: false },
    action: { type: DataTypes.ENUM(...CONSENT_ACTIONS), allowNull: false },
    source: { type: DataTypes.STRING(80), allowNull: false },
    phone: { type: DataTypes.STRING(15), allowNull: false },
    normalized_text: { type: DataTypes.STRING(255), allowNull: true },
    meta_message_id: { type: DataTypes.STRING(255), allowNull: true },
    webhook_event_id: { type: DataTypes.INTEGER, allowNull: true },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
    evidence_json: { type: DataTypes.TEXT, allowNull: true },
    event_at: { type: DataTypes.DATE, allowNull: false },
    processed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
  },
  {
    tableName: "whatsapp_consent_events",
    timestamps: false,
    indexes: [
      {
        name: "idx_whatsapp_consent_contact_history",
        fields: ["contact_type", "contact_id", "created_at"]
      },
      { name: "idx_whatsapp_consent_meta_message", fields: ["meta_message_id"] },
      {
        name: "uq_whatsapp_consent_meta_action",
        unique: true,
        fields: ["meta_message_id", "action"]
      }
    ]
  }
);

module.exports = WhatsAppConsentEvent;
