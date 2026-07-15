const { DataTypes } = require("sequelize");

module.exports = {
  up: async ({ queryInterface }) => {
    const columns = await queryInterface.describeTable("messages");
    if (!columns.delivery_evidence) {
      await queryInterface.addColumn("messages", "delivery_evidence", {
        type: DataTypes.STRING(40),
        allowNull: true
      });
    }
  }
};
