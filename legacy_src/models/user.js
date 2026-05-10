module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    "user",
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
      role: {
        type: DataTypes.ENUM("admin", "agent"),
        allowNull: false,
        defaultValue: "agent"
      }
    },
    {
      tableName: "user",
      timestamps: false,
      indexes: [{ fields: ["role"] }]
    }
  );