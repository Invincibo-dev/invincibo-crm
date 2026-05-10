const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const TrackingEvent = sequelize.define(
  "TrackingEvent",
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
    event_type: {
      type: DataTypes.ENUM("click", "visit", "conversion"),
      allowNull: false
    },
    source: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: "whatsapp"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: "tracking_event",
    timestamps: false,
    indexes: [
      { fields: ["student_id"] },
      { fields: ["event_type"] },
      { fields: ["source"] },
      { fields: ["created_at"] }
    ]
  }
);

module.exports = TrackingEvent;
