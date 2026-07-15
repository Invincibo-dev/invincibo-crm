const { DataTypes } = require("sequelize");
const { WEBHOOK_EVENT_STATES } = require("../config/whatsappStates");

const addColumnIfMissing = async (queryInterface, table, column, definition) => {
  const columns = await queryInterface.describeTable(table);
  if (!columns[column]) {
    await queryInterface.addColumn(table, column, definition);
  }
};

module.exports = {
  up: async ({ queryInterface, sequelize }) => {
    const counters = [
      "statuses_found",
      "processed_count",
      "ignored_count",
      "unmatched_count",
      "failed_count"
    ];
    for (const column of counters) {
      await addColumnIfMissing(queryInterface, "whatsapp_webhook_events", column, {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      });
    }
    await addColumnIfMissing(
      queryInterface,
      "whatsapp_webhook_events",
      "processed_status_keys_json",
      { type: DataTypes.TEXT, allowNull: true }
    );
    await addColumnIfMissing(queryInterface, "whatsapp_webhook_events", "processing_summary_json", {
      type: DataTypes.TEXT,
      allowNull: true
    });

    if (sequelize.getDialect() === "mysql") {
      await queryInterface.changeColumn("whatsapp_webhook_events", "state", {
        type: DataTypes.ENUM(...WEBHOOK_EVENT_STATES),
        allowNull: false,
        defaultValue: "received"
      });
    }
  }
};
