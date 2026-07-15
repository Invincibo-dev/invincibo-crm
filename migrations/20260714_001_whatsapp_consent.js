const { DataTypes } = require("sequelize");

const addColumnIfMissing = async (queryInterface, table, column, definition) => {
  const columns = await queryInterface.describeTable(table);
  if (!columns[column]) {
    await queryInterface.addColumn(table, column, definition);
  }
};

module.exports = {
  up: async ({ queryInterface }) => {
    await addColumnIfMissing(queryInterface, "leads", "whatsapp_opt_in", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await addColumnIfMissing(queryInterface, "leads", "whatsapp_opt_in_at", {
      type: DataTypes.DATE,
      allowNull: true
    });
    await addColumnIfMissing(queryInterface, "leads", "whatsapp_opt_out_at", {
      type: DataTypes.DATE,
      allowNull: true
    });
  }
};
