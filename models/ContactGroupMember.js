const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ContactGroupMember = sequelize.define(
  "ContactGroupMember",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    group_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    contact_type: {
      type: DataTypes.ENUM("lead", "student"),
      allowNull: false
    },
    contact_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    problem_reason: {
      type: DataTypes.STRING(255),
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
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: "contact_group_members",
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ["group_id", "contact_type", "contact_id"]
      }
    ]
  }
);

module.exports = ContactGroupMember;
