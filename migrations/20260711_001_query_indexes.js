const addIndexIfMissing = async (queryInterface, table, fields, options = {}) => {
  const indexes = await queryInterface.showIndex(table);
  const name = options.name;
  if (indexes.some((index) => index.name === name)) return;
  await queryInterface.addIndex(table, fields, options);
};

module.exports = {
  up: async ({ queryInterface }) => {
    const indexes = [
      ["leads", ["created_at"], { name: "idx_leads_created_at" }],
      ["leads", ["status", "created_at"], { name: "idx_leads_status_created_at" }],
      ["leads", ["score"], { name: "idx_leads_score" }],
      ["messages", ["status", "created_at"], { name: "idx_messages_status_created_at" }],
      ["followups", ["status", "cancelled", "scheduled_date"], { name: "idx_followups_due" }],
      ["contact_groups", ["created_at"], { name: "idx_contact_groups_created_at" }],
      [
        "contact_group_members",
        ["group_id", "created_at"],
        { name: "idx_group_members_created_at" }
      ],
      ["student", ["status", "created_at"], { name: "idx_student_status_created_at" }],
      ["student_action", ["student_id", "created_at"], { name: "idx_student_action_history" }],
      ["tasks", ["status", "priority", "created_at"], { name: "idx_tasks_open_queue" }],
      ["tracking_event", ["student_id", "created_at"], { name: "idx_tracking_student_history" }],
      ["audit_logs", ["entity", "entity_id", "created_at"], { name: "idx_audit_entity_history" }]
    ];

    for (const [table, fields, options] of indexes) {
      await addIndexIfMissing(queryInterface, table, fields, options);
    }
  }
};
