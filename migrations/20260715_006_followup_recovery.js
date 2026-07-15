const { DataTypes } = require("sequelize");

const addColumnIfMissing = async (queryInterface, table, column, definition) => {
  const columns = await queryInterface.describeTable(table);
  if (!columns[column]) await queryInterface.addColumn(table, column, definition);
};

const addIndexIfMissing = async (queryInterface, table, fields, options) => {
  const indexes = await queryInterface.showIndex(table);
  if (!indexes.some((index) => index.name === options.name)) {
    await queryInterface.addIndex(table, fields, options);
  }
};

module.exports = {
  up: async ({ queryInterface }) => {
    const columns = [
      ["review_note", { type: DataTypes.TEXT, allowNull: true }],
      ["recovery_source", { type: DataTypes.STRING(40), allowNull: true }],
      ["delivery_evidence", { type: DataTypes.STRING(40), allowNull: true }],
      ["updated_at", { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }]
    ];
    for (const [column, definition] of columns) {
      await addColumnIfMissing(queryInterface, "followups", column, definition);
    }
    await addIndexIfMissing(
      queryInterface,
      "followups",
      ["status", "processing_started_at", "updated_at"],
      { name: "idx_followups_stuck_recovery" }
    );
  }
};
