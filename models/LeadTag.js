const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const LeadTag = sequelize.define(
  "LeadTag",
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
    tag_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    }
  },
  {
    tableName: "lead_tags",
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ["lead_id", "tag_id"]
      }
    ]
  }
);

module.exports = LeadTag;
