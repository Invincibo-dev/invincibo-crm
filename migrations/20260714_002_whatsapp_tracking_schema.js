const { DataTypes } = require("sequelize");
const {
  CONSENT_ACTIONS,
  CONSENT_CONTACT_TYPES,
  FOLLOWUP_STATUSES,
  MESSAGE_DIRECTIONS,
  MESSAGE_STATUSES,
  MESSAGE_TYPES,
  META_MESSAGE_STATUSES,
  WEBHOOK_EVENT_TYPES
} = require("../config/whatsappStates");

const addColumnIfMissing = async (queryInterface, table, column, definition) => {
  const columns = await queryInterface.describeTable(table);
  if (!columns[column]) {
    await queryInterface.addColumn(table, column, definition);
  }
};

const tableExists = async (queryInterface, table) => {
  const tables = await queryInterface.showAllTables();
  return tables.some((entry) => {
    const name = typeof entry === "string" ? entry : entry.tableName || entry.table_name;
    return String(name).toLowerCase() === table.toLowerCase();
  });
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
  if (Number(rows[0]?.count || 0) === 0) {
    await queryInterface.addConstraint(table, options);
  }
};

module.exports = {
  up: async ({ queryInterface, sequelize }) => {
    await addColumnIfMissing(queryInterface, "leads", "whatsapp_opt_in_source", {
      type: DataTypes.STRING(80),
      allowNull: true
    });
    await addColumnIfMissing(queryInterface, "leads", "whatsapp_opt_out_source", {
      type: DataTypes.STRING(80),
      allowNull: true
    });
    await addColumnIfMissing(queryInterface, "leads", "whatsapp_service_window_expires_at", {
      type: DataTypes.DATE,
      allowNull: true
    });

    const studentConsentColumns = [
      ["whatsapp_opt_in", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }],
      ["whatsapp_opt_in_at", { type: DataTypes.DATE, allowNull: true }],
      ["whatsapp_opt_in_source", { type: DataTypes.STRING(80), allowNull: true }],
      ["whatsapp_opt_out_at", { type: DataTypes.DATE, allowNull: true }],
      ["whatsapp_opt_out_source", { type: DataTypes.STRING(80), allowNull: true }],
      ["whatsapp_service_window_expires_at", { type: DataTypes.DATE, allowNull: true }]
    ];
    for (const [column, definition] of studentConsentColumns) {
      await addColumnIfMissing(queryInterface, "student", column, definition);
    }

    const messageColumns = [
      ["student_id", { type: DataTypes.INTEGER, allowNull: true }],
      [
        "direction",
        {
          type: DataTypes.ENUM(...MESSAGE_DIRECTIONS),
          allowNull: false,
          defaultValue: "outbound"
        }
      ],
      ["template_name", { type: DataTypes.STRING(255), allowNull: true }],
      ["template_language", { type: DataTypes.STRING(20), allowNull: true }],
      ["template_parameters_json", { type: DataTypes.TEXT, allowNull: true }],
      ["meta_message_id", { type: DataTypes.STRING(255), allowNull: true }],
      ["meta_status", { type: DataTypes.ENUM(...META_MESSAGE_STATUSES), allowNull: true }],
      ["meta_error_code", { type: DataTypes.STRING(80), allowNull: true }],
      ["meta_error_message", { type: DataTypes.TEXT, allowNull: true }],
      ["accepted_at", { type: DataTypes.DATE, allowNull: true }],
      ["sent_at", { type: DataTypes.DATE, allowNull: true }],
      ["delivered_at", { type: DataTypes.DATE, allowNull: true }],
      ["read_at", { type: DataTypes.DATE, allowNull: true }],
      ["failed_at", { type: DataTypes.DATE, allowNull: true }],
      ["updated_at", { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }]
    ];
    for (const [column, definition] of messageColumns) {
      await addColumnIfMissing(queryInterface, "messages", column, definition);
    }

    const followupColumns = [
      ["meta_status", { type: DataTypes.ENUM(...META_MESSAGE_STATUSES), allowNull: true }],
      ["meta_error_code", { type: DataTypes.STRING(80), allowNull: true }],
      ["meta_error_message", { type: DataTypes.TEXT, allowNull: true }],
      ["accepted_at", { type: DataTypes.DATE, allowNull: true }],
      ["delivered_at", { type: DataTypes.DATE, allowNull: true }],
      ["read_at", { type: DataTypes.DATE, allowNull: true }],
      ["failed_at", { type: DataTypes.DATE, allowNull: true }],
      ["review_reason", { type: DataTypes.TEXT, allowNull: true }],
      ["reviewed_at", { type: DataTypes.DATE, allowNull: true }],
      ["reviewed_by", { type: DataTypes.INTEGER, allowNull: true }]
    ];
    for (const [column, definition] of followupColumns) {
      await addColumnIfMissing(queryInterface, "followups", column, definition);
    }

    if (sequelize.getDialect() === "mysql") {
      await queryInterface.changeColumn("messages", "lead_id", {
        type: DataTypes.INTEGER,
        allowNull: true
      });
      await queryInterface.changeColumn("messages", "type", {
        type: DataTypes.ENUM(...MESSAGE_TYPES),
        allowNull: false,
        defaultValue: "initial"
      });
      await queryInterface.changeColumn("messages", "status", {
        type: DataTypes.ENUM(...MESSAGE_STATUSES),
        allowNull: false,
        defaultValue: "pending"
      });
      await queryInterface.changeColumn("followups", "status", {
        type: DataTypes.ENUM(...FOLLOWUP_STATUSES),
        allowNull: false,
        defaultValue: "pending"
      });
    }

    if (!(await tableExists(queryInterface, "whatsapp_webhook_events"))) {
      await queryInterface.createTable("whatsapp_webhook_events", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        event_key: { type: DataTypes.STRING(255), allowNull: false },
        event_type: { type: DataTypes.ENUM(...WEBHOOK_EVENT_TYPES), allowNull: false },
        meta_message_id: { type: DataTypes.STRING(255), allowNull: true },
        payload_json: { type: DataTypes.TEXT("long"), allowNull: false },
        received_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        processed_at: { type: DataTypes.DATE, allowNull: true },
        processing_error: { type: DataTypes.TEXT, allowNull: true }
      });
    }

    if (!(await tableExists(queryInterface, "whatsapp_consent_events"))) {
      await queryInterface.createTable("whatsapp_consent_events", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        contact_type: {
          type: DataTypes.ENUM(...CONSENT_CONTACT_TYPES),
          allowNull: false
        },
        contact_id: { type: DataTypes.INTEGER, allowNull: false },
        action: { type: DataTypes.ENUM(...CONSENT_ACTIONS), allowNull: false },
        source: { type: DataTypes.STRING(80), allowNull: false },
        meta_message_id: { type: DataTypes.STRING(255), allowNull: true },
        webhook_event_id: { type: DataTypes.INTEGER, allowNull: true },
        created_by: { type: DataTypes.INTEGER, allowNull: true },
        evidence_json: { type: DataTypes.TEXT, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
      });
    }

    const indexes = [
      ["messages", ["student_id", "created_at"], { name: "idx_messages_student_history" }],
      ["messages", ["meta_message_id"], { name: "uq_messages_meta_message_id", unique: true }],
      [
        "followups",
        ["status", "processing_started_at"],
        { name: "idx_followups_processing_review" }
      ],
      [
        "whatsapp_webhook_events",
        ["event_key"],
        { name: "uq_whatsapp_webhook_event_key", unique: true }
      ],
      [
        "whatsapp_webhook_events",
        ["meta_message_id"],
        { name: "idx_whatsapp_webhook_meta_message" }
      ],
      [
        "whatsapp_webhook_events",
        ["event_type", "received_at"],
        { name: "idx_whatsapp_webhook_type_received" }
      ],
      [
        "whatsapp_consent_events",
        ["contact_type", "contact_id", "created_at"],
        { name: "idx_whatsapp_consent_contact_history" }
      ],
      [
        "whatsapp_consent_events",
        ["meta_message_id"],
        { name: "idx_whatsapp_consent_meta_message" }
      ]
    ];
    for (const [table, fields, options] of indexes) {
      await addIndexIfMissing(queryInterface, table, fields, options);
    }

    await addMysqlConstraintIfMissing(
      queryInterface,
      sequelize,
      "messages",
      "fk_messages_student",
      {
        fields: ["student_id"],
        type: "foreign key",
        name: "fk_messages_student",
        references: { table: "student", field: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE"
      }
    );
    await addMysqlConstraintIfMissing(
      queryInterface,
      sequelize,
      "followups",
      "fk_followups_reviewer",
      {
        fields: ["reviewed_by"],
        type: "foreign key",
        name: "fk_followups_reviewer",
        references: { table: "users", field: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE"
      }
    );
    await addMysqlConstraintIfMissing(
      queryInterface,
      sequelize,
      "whatsapp_consent_events",
      "fk_whatsapp_consent_webhook",
      {
        fields: ["webhook_event_id"],
        type: "foreign key",
        name: "fk_whatsapp_consent_webhook",
        references: { table: "whatsapp_webhook_events", field: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE"
      }
    );
    await addMysqlConstraintIfMissing(
      queryInterface,
      sequelize,
      "whatsapp_consent_events",
      "fk_whatsapp_consent_user",
      {
        fields: ["created_by"],
        type: "foreign key",
        name: "fk_whatsapp_consent_user",
        references: { table: "users", field: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE"
      }
    );
  }
};
