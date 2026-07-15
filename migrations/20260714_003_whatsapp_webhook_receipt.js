const { DataTypes } = require("sequelize");
const { WEBHOOK_EVENT_STATES } = require("../config/whatsappStates");

const addColumnIfMissing = async (queryInterface, table, column, definition) => {
  const columns = await queryInterface.describeTable(table);
  if (!columns[column]) {
    await queryInterface.addColumn(table, column, definition);
  }
};

module.exports = {
  up: async ({ queryInterface }) => {
    await addColumnIfMissing(queryInterface, "whatsapp_webhook_events", "state", {
      type: DataTypes.ENUM(...WEBHOOK_EVENT_STATES),
      allowNull: false,
      defaultValue: "received"
    });
    await addColumnIfMissing(queryInterface, "whatsapp_webhook_events", "signature_verified", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    });
  }
};
