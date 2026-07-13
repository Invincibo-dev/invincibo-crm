const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const BootstrapLock = sequelize.define(
  "BootstrapLock",
  {
    key: {
      type: DataTypes.STRING(80),
      primaryKey: true
    },
    claimed_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: "bootstrap_locks",
    timestamps: false
  }
);

module.exports = BootstrapLock;
