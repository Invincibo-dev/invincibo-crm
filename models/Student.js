const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const { normalizeWhatsAppPhone } = require("../services/whatsappPhoneService");

const STATUSES = [
  "paid_training",
  "onboarding",
  "step1",
  "active",
  "inactive",
  "blocked",
  "at_risk"
];

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
    whatsapp_phone_normalized: {
      type: DataTypes.STRING(15),
      allowNull: true
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
    }
  },
  {
    tableName: "student",
    timestamps: false,
    indexes: [
      { fields: ["status"] },
      { fields: ["last_action_at"] },
      { name: "idx_student_whatsapp_phone", fields: ["whatsapp_phone_normalized"] }
    ],
    hooks: {
      beforeValidate(student) {
        student.whatsapp_phone_normalized = normalizeWhatsAppPhone(student.phone);
      }
    }
  }
);

module.exports = Student;
