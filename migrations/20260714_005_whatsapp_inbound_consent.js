const { DataTypes } = require("sequelize");
const {
  MESSAGE_STATUSES,
  WEBHOOK_EVENT_STATES,
  WEBHOOK_EVENT_TYPES
} = require("../config/whatsappStates");

const normalizePhone = (value) => {
  const compact = String(value || "")
    .trim()
    .replace(/[\s()+-]/g, "");
  return /^\d{7,15}$/.test(compact) ? compact : null;
};

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

const addMysqlConstraintIfMissing = async (
  queryInterface,
  sequelize,
  table,
  constraintName,
  options
) => {
  if (sequelize.getDialect() !== "mysql") return;
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS count
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = :table
        AND CONSTRAINT_NAME = :constraintName`,
    { replacements: { table, constraintName } }
  );
  if (Number(rows[0]?.count || 0) === 0) await queryInterface.addConstraint(table, options);
};

module.exports = {
  up: async ({ queryInterface, sequelize }) => {
    for (const table of ["leads", "student"]) {
      await addColumnIfMissing(queryInterface, table, "whatsapp_phone_normalized", {
        type: DataTypes.STRING(15),
        allowNull: true
      });
      const [rows] = await sequelize.query(
        `SELECT id, phone FROM ${queryInterface.queryGenerator.quoteTable(table)} WHERE whatsapp_phone_normalized IS NULL`
      );
      for (const row of rows) {
        const normalized = normalizePhone(row.phone);
        if (normalized) {
          await queryInterface.bulkUpdate(
            table,
            { whatsapp_phone_normalized: normalized },
            { id: row.id }
          );
        }
      }
    }

    const messageColumns = [
      ["source_phone", { type: DataTypes.STRING(15), allowNull: true }],
      ["source", { type: DataTypes.STRING(30), allowNull: true }],
      ["inbound_message_type", { type: DataTypes.STRING(30), allowNull: true }],
      ["context_message_id", { type: DataTypes.STRING(255), allowNull: true }],
      ["webhook_event_id", { type: DataTypes.INTEGER, allowNull: true }],
      ["received_at", { type: DataTypes.DATE, allowNull: true }]
    ];
    for (const [column, definition] of messageColumns) {
      await addColumnIfMissing(queryInterface, "messages", column, definition);
    }

    const consentColumns = [
      ["phone", { type: DataTypes.STRING(15), allowNull: true }],
      ["normalized_text", { type: DataTypes.STRING(255), allowNull: true }],
      ["event_at", { type: DataTypes.DATE, allowNull: true }],
      ["processed_at", { type: DataTypes.DATE, allowNull: true }]
    ];
    for (const [column, definition] of consentColumns) {
      await addColumnIfMissing(queryInterface, "whatsapp_consent_events", column, definition);
    }

    const messageCounters = [
      "messages_found",
      "messages_matched",
      "messages_unmatched",
      "messages_opt_out",
      "messages_ignored",
      "messages_failed"
    ];
    for (const column of messageCounters) {
      await addColumnIfMissing(queryInterface, "whatsapp_webhook_events", column, {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      });
    }
    await addColumnIfMissing(
      queryInterface,
      "whatsapp_webhook_events",
      "processed_message_keys_json",
      { type: DataTypes.TEXT, allowNull: true }
    );

    const indexes = [
      ["leads", ["whatsapp_phone_normalized"], { name: "idx_leads_whatsapp_phone" }],
      ["student", ["whatsapp_phone_normalized"], { name: "idx_student_whatsapp_phone" }],
      ["messages", ["webhook_event_id"], { name: "idx_messages_webhook_event" }],
      ["messages", ["source_phone", "received_at"], { name: "idx_messages_source_phone" }],
      [
        "whatsapp_consent_events",
        ["meta_message_id", "action"],
        { name: "uq_whatsapp_consent_meta_action", unique: true }
      ]
    ];
    for (const [table, fields, options] of indexes) {
      await addIndexIfMissing(queryInterface, table, fields, options);
    }

    if (sequelize.getDialect() === "mysql") {
      await queryInterface.changeColumn("messages", "status", {
        type: DataTypes.ENUM(...MESSAGE_STATUSES),
        allowNull: false,
        defaultValue: "pending"
      });
      await queryInterface.changeColumn("whatsapp_webhook_events", "event_type", {
        type: DataTypes.ENUM(...WEBHOOK_EVENT_TYPES),
        allowNull: false
      });
      await queryInterface.changeColumn("whatsapp_webhook_events", "state", {
        type: DataTypes.ENUM(...WEBHOOK_EVENT_STATES),
        allowNull: false,
        defaultValue: "received"
      });
    }

    await addMysqlConstraintIfMissing(
      queryInterface,
      sequelize,
      "messages",
      "fk_messages_webhook_event",
      {
        fields: ["webhook_event_id"],
        type: "foreign key",
        name: "fk_messages_webhook_event",
        references: { table: "whatsapp_webhook_events", field: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE"
      }
    );
  }
};
