process.env.DB_DIALECT = "sqlite";
process.env.DB_STORAGE = ":memory:";

const {
  FollowUp,
  Lead,
  Message,
  Student,
  WhatsAppConsentEvent,
  WhatsAppWebhookEvent,
  sequelize
} = require("../models");

describe("WhatsApp tracking schema", () => {
  beforeAll(async () => {
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test("stores consent for students as well as leads", async () => {
    const student = await Student.create({
      name: "Student Consent",
      phone: "+50934000010",
      whatsapp_opt_in: true,
      whatsapp_opt_in_at: new Date(),
      whatsapp_opt_in_source: "admin_confirmed"
    });
    await student.reload();

    expect(student.whatsapp_opt_in).toBe(true);
    expect(student.whatsapp_opt_in_at).toBeTruthy();
    expect(student.whatsapp_opt_in_source).toBe("admin_confirmed");
    expect(student.whatsapp_opt_out_at).toBeNull();
  });

  test("stores an accepted template with its Meta identity and parameters", async () => {
    const lead = await Lead.create({ name: "Template Lead", phone: "+50934000011" });
    const acceptedAt = new Date();
    const message = await Message.create({
      lead_id: lead.id,
      message: "template:crm_followup_reminder",
      type: "followup",
      direction: "outbound",
      status: "accepted",
      template_name: "crm_followup_reminder",
      template_language: "fr",
      template_parameters_json: JSON.stringify([{ type: "text", text: "Jean" }]),
      meta_message_id: "wamid.schema-test-1",
      meta_status: "accepted",
      accepted_at: acceptedAt
    });
    await message.reload();

    expect(message.status).toBe("accepted");
    expect(message.meta_message_id).toBe("wamid.schema-test-1");
    expect(message.template_name).toBe("crm_followup_reminder");
    expect(message.accepted_at).toEqual(acceptedAt);
    expect(message.delivered_at).toBeNull();
  });

  test("requires one contact for outbound and allows unmatched inbound messages", async () => {
    await expect(
      Message.create({
        message: "orphan",
        type: "followup",
        direction: "outbound",
        status: "delivered"
      })
    ).rejects.toThrow("requires exactly one contact");

    const inbound = await Message.create({
      message: "unmatched inbound",
      type: "inbound",
      direction: "inbound",
      status: "received"
    });
    expect(inbound.id).toBeTruthy();
  });

  test("supports needs_review without treating the follow-up as completed", async () => {
    const lead = await Lead.create({ name: "Review Lead", phone: "+50934000012" });
    const followUp = await FollowUp.create({
      lead_id: lead.id,
      scheduled_date: new Date(),
      message: "template:crm_followup_reminder",
      status: "needs_review",
      review_reason: "ambiguous_delivery"
    });
    await followUp.reload();

    expect(followUp.status).toBe("needs_review");
    expect(followUp.review_reason).toBe("ambiguous_delivery");
    expect(followUp.reviewed_at).toBeNull();
  });

  test("deduplicates webhook evidence and links an opt-out proof", async () => {
    const event = await WhatsAppWebhookEvent.create({
      event_key: "message:wamid.inbound-stop",
      event_type: "message",
      meta_message_id: "wamid.inbound-stop",
      payload_json: JSON.stringify({ object: "whatsapp_business_account" })
    });
    const consentEvent = await WhatsAppConsentEvent.create({
      contact_type: "lead",
      contact_id: 99,
      action: "opt_out",
      source: "whatsapp_stop",
      phone: "50934000099",
      meta_message_id: "wamid.inbound-stop",
      webhook_event_id: event.id,
      evidence_json: JSON.stringify({ normalized_text: "STOP" }),
      event_at: new Date()
    });

    await expect(
      WhatsAppWebhookEvent.create({
        event_key: "message:wamid.inbound-stop",
        event_type: "message",
        meta_message_id: "wamid.inbound-stop",
        payload_json: "{}"
      })
    ).rejects.toThrow();
    expect(consentEvent.webhook_event_id).toBe(event.id);
    expect(consentEvent.action).toBe("opt_out");
  });
});
