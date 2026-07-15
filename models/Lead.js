const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const { normalizeWhatsAppPhone } = require("../services/whatsappPhoneService");

const Lead = sequelize.define(
  "Lead",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    first_name: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    last_name: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    gender: {
      type: DataTypes.ENUM("male", "female", "unknown"),
      allowNull: false,
      defaultValue: "unknown"
    },
    phone: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    whatsapp_phone_normalized: {
      type: DataTypes.STRING(15),
      allowNull: true
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isEmail: true
      }
    },
    source: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM("new", "contacted", "client", "no_response"),
      allowNull: false,
      defaultValue: "new"
    },
    score: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    last_contact_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    follow_up_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    whatsapp_opt_in: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    whatsapp_opt_in_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    whatsapp_opt_in_source: {
      type: DataTypes.STRING(80),
      allowNull: true
    },
    whatsapp_opt_out_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    whatsapp_opt_out_source: {
      type: DataTypes.STRING(80),
      allowNull: true
    },
    whatsapp_service_window_expires_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: "leads",
    timestamps: false,
    indexes: [{ name: "idx_leads_whatsapp_phone", fields: ["whatsapp_phone_normalized"] }],
    hooks: {
      beforeValidate(lead) {
        lead.whatsapp_phone_normalized = normalizeWhatsAppPhone(lead.phone);
      }
    }
  }
);

module.exports = Lead;
