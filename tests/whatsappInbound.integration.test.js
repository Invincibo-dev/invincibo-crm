const crypto = require("crypto");
const request = require("supertest");

process.env.NODE_ENV = "test";
process.env.DB_DIALECT = "sqlite";
process.env.DB_STORAGE = ":memory:";
process.env.WHATSAPP_APP_SECRET = "inbound_test_app_secret";
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "inbound_test_verify_token";
process.env.API_RATE_LIMIT_MAX = "100000";

const app = require("../app");
const {
  FollowUp,
  Lead,
  Message,
  Student,
  WhatsAppConsentEvent,
  WhatsAppWebhookEvent,
  sequelize
} = require("../models");
const activationAutomationService = require("../services/activation/automationService");
const activationWhatsappService = require("../services/activation/whatsappService");
const groupService = require("../services/groupService");
const leadWhatsappService = require("../services/whatsappService");
const { isOptOutMessage, recordExplicitOptIn } = require("../services/whatsappConsentService");
const { normalizeWhatsAppPhone } = require("../services/whatsappPhoneService");

const sign = (body) =>
  `sha256=${crypto
    .createHmac("sha256", process.env.WHATSAPP_APP_SECRET)
    .update(Buffer.from(body))
    .digest("hex")}`;

const inboundMessage = ({
  id = "wamid.inbound-1",
  from = "50934000001",
  text = "Bonjour",
  type = "text",
  timestamp = "1784080000"
} = {}) => ({
  from,
  id,
  timestamp,
  type,
  ...(type === "text" ? { text: { body: text } } : { image: { id: "media-test" } })
});

const inboundPayload = (messages, { statuses = [], contacts = null } = {}) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba-inbound-test",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "50937000099",
              phone_number_id: "phone-number-id-test"
            },
            contacts:
              contacts ||
              messages.map((message) => ({
                profile: { name: `Profile ${message.from}` },
                wa_id: message.from
              })),
            messages,
            statuses
          }
        }
      ]
    }
  ]
});

const postPayload = (payload) => {
  const body = JSON.stringify(payload);
  return request(app)
    .post("/api/webhooks/whatsapp")
    .set("Content-Type", "application/json")
    .set("X-Hub-Signature-256", sign(body))
    .send(body);
};

const createOptedInLead = (overrides = {}) =>
  Lead.create({
    name: "Inbound Lead",
    phone: "+509 34 00 00 01",
    whatsapp_opt_in: true,
    whatsapp_opt_in_at: new Date("2026-07-01T12:00:00.000Z"),
    whatsapp_opt_in_source: "form",
    ...overrides
  });

describe("WhatsApp inbound messages and consent", () => {
  beforeAll(async () => {
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    process.env.WHATSAPP_SEND_ENABLED = "false";
    await sequelize.truncate({ cascade: true, restartIdentity: true });
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test("normalizes only plausible international WhatsApp numbers", () => {
    expect(normalizeWhatsAppPhone(" +509 (34) 00-00-01 ")).toBe("50934000001");
    expect(normalizeWhatsAppPhone("34000001")).toBe("34000001");
    expect(normalizeWhatsAppPhone("+509ABC3400")).toBeNull();
    expect(normalizeWhatsAppPhone("123")).toBeNull();
  });

  test.each(["STOP", "  stop  ", "ARRÊT", "SISPANN", "Tanpri stop voye mesaj sa yo"])(
    "recognizes a clear opt-out through the real webhook: %s",
    async (text) => {
      const lead = await createOptedInLead();
      const response = await postPayload(inboundPayload([inboundMessage({ text })]));

      expect(response.status).toBe(200);
      await lead.reload();
      expect(lead.whatsapp_opt_in).toBe(false);
      expect(lead.whatsapp_opt_out_at).toEqual(new Date(1784080000 * 1000));
      expect(lead.whatsapp_opt_out_source).toBe("inbound_whatsapp");
      expect(await WhatsAppConsentEvent.count({ where: { action: "opt_out" } })).toBe(1);
    }
  );

  test("recognizes PA STOP exactly but avoids a contextual false positive", async () => {
    expect(isOptOutMessage("PA STOP")).toBe(true);
    const lead = await createOptedInLead();
    const response = await postPayload(
      inboundPayload([inboundMessage({ text: "Pa stop travay la" })])
    );

    expect(response.status).toBe(200);
    await lead.reload();
    expect(lead.whatsapp_opt_in).toBe(true);
    expect(lead.whatsapp_opt_out_at).toBeNull();
    expect(await WhatsAppConsentEvent.count()).toBe(0);
    expect(await Message.count({ where: { direction: "inbound" } })).toBe(1);
  });

  test("stores a normalized, matched inbound text without automatic opt-in", async () => {
    const lead = await Lead.create({ name: "No Auto Opt-in", phone: "+509-34-00-00-01" });
    const response = await postPayload(
      inboundPayload([inboundMessage({ text: "Bonjour equipe" })])
    );

    expect(response.status).toBe(200);
    const message = await Message.findOne({ where: { meta_message_id: "wamid.inbound-1" } });
    expect(message.direction).toBe("inbound");
    expect(message.status).toBe("received");
    expect(message.lead_id).toBe(lead.id);
    expect(message.student_id).toBeNull();
    expect(message.source_phone).toBe("50934000001");
    expect(message.source).toBe("whatsapp");
    expect(message.received_at).toEqual(new Date(1784080000 * 1000));
    await lead.reload();
    expect(lead.whatsapp_opt_in).toBe(false);
    const event = await WhatsAppWebhookEvent.findOne();
    expect(event.messages_found).toBe(1);
    expect(event.messages_matched).toBe(1);
    expect(event.state).toBe("processed");
  });

  test("processes multiple messages across several entries and changes", async () => {
    const lead = await createOptedInLead();
    const student = await Student.create({ name: "Inbound Student", phone: "+509 34 00 00 02" });
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: "50934000001", profile: { name: "Lead Profile" } }],
                metadata: { phone_number_id: "test" },
                messages: [inboundMessage({ id: "wamid.multi-in-1", text: "Premier" })]
              }
            }
          ]
        },
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: "50934000002", profile: { name: "Student Profile" } }],
                metadata: { phone_number_id: "test" },
                messages: [
                  inboundMessage({
                    id: "wamid.multi-in-2",
                    from: "50934000002",
                    text: "Deuxieme"
                  })
                ]
              }
            }
          ]
        }
      ]
    };

    expect((await postPayload(payload)).status).toBe(200);
    expect(await Message.count({ where: { direction: "inbound" } })).toBe(2);
    expect(await Message.count({ where: { lead_id: lead.id } })).toBe(1);
    expect(await Message.count({ where: { student_id: student.id } })).toBe(1);
    const event = await WhatsAppWebhookEvent.findOne();
    expect(event.messages_found).toBe(2);
    expect(event.messages_matched).toBe(2);
    expect(event.state).toBe("processed");
  });

  test("processes statuses and inbound messages in one aggregated receipt", async () => {
    const lead = await createOptedInLead();
    await Message.create({
      lead_id: lead.id,
      message: "outbound",
      type: "followup",
      status: "accepted",
      meta_status: "accepted",
      meta_message_id: "wamid.outbound-mixed",
      accepted_at: new Date("2026-07-14T20:00:00.000Z")
    });
    const status = {
      id: "wamid.outbound-mixed",
      status: "delivered",
      timestamp: "1784080100",
      recipient_id: "50934000001"
    };

    const response = await postPayload(
      inboundPayload([inboundMessage({ id: "wamid.inbound-mixed" })], { statuses: [status] })
    );

    expect(response.status).toBe(200);
    const outbound = await Message.findOne({ where: { meta_message_id: status.id } });
    expect(outbound.meta_status).toBe("delivered");
    expect(await Message.count({ where: { direction: "inbound" } })).toBe(1);
    const event = await WhatsAppWebhookEvent.findOne();
    expect(event.event_type).toBe("mixed");
    expect(event.statuses_found).toBe(1);
    expect(event.messages_found).toBe(1);
    expect(event.processed_count).toBe(1);
    expect(event.messages_matched).toBe(1);
    expect(event.state).toBe("processed");
  });

  test("ignores an unsupported inbound type without crashing", async () => {
    await createOptedInLead();
    const response = await postPayload(
      inboundPayload([inboundMessage({ type: "sticker", text: undefined })])
    );

    expect(response.status).toBe(200);
    expect(await Message.count()).toBe(0);
    const event = await WhatsAppWebhookEvent.findOne();
    expect(event.messages_ignored).toBe(1);
    expect(event.state).toBe("ignored");
  });

  test("deduplicates a repeated STOP webhook and preserves the original opt-in history", async () => {
    const originalOptInAt = new Date("2026-06-01T10:00:00.000Z");
    const lead = await createOptedInLead({ whatsapp_opt_in_at: originalOptInAt });
    const payload = inboundPayload([inboundMessage({ text: "STOP" })]);

    expect((await postPayload(payload)).status).toBe(200);
    expect((await postPayload(payload)).status).toBe(200);
    await lead.reload();
    expect(lead.whatsapp_opt_in_at).toEqual(originalOptInAt);
    expect(await Message.count({ where: { meta_message_id: "wamid.inbound-1" } })).toBe(1);
    expect(await WhatsAppConsentEvent.count()).toBe(1);
    expect(await WhatsAppWebhookEvent.count()).toBe(1);
  });

  test("opts out a Student when no Lead matches", async () => {
    const student = await Student.create({
      name: "STOP Student",
      phone: "+509 34 00 00 01",
      whatsapp_opt_in: true,
      whatsapp_opt_in_at: new Date()
    });

    expect((await postPayload(inboundPayload([inboundMessage({ text: "SISPANN" })]))).status).toBe(
      200
    );
    await student.reload();
    expect(student.whatsapp_opt_in).toBe(false);
    expect(student.whatsapp_opt_out_source).toBe("inbound_whatsapp");
    const consent = await WhatsAppConsentEvent.findOne();
    expect(consent.contact_type).toBe("student");
    expect(consent.contact_id).toBe(student.id);
  });

  test("prioritizes Lead when Lead and Student share the normalized phone", async () => {
    const lead = await createOptedInLead();
    const student = await Student.create({ name: "Same Phone Student", phone: "50934000001" });

    expect((await postPayload(inboundPayload([inboundMessage()]))).status).toBe(200);
    const message = await Message.findOne({ where: { direction: "inbound" } });
    expect(message.lead_id).toBe(lead.id);
    expect(message.student_id).toBeNull();
    expect(message.student_id).not.toBe(student.id);
  });

  test("keeps the first withdrawal date for an already opted-out contact", async () => {
    const originalOptOutAt = new Date("2026-06-10T10:00:00.000Z");
    const lead = await createOptedInLead({
      whatsapp_opt_in: false,
      whatsapp_opt_out_at: originalOptOutAt,
      whatsapp_opt_out_source: "previous_stop"
    });

    expect((await postPayload(inboundPayload([inboundMessage({ text: "STOP" })]))).status).toBe(
      200
    );
    await lead.reload();
    expect(lead.whatsapp_opt_out_at).toEqual(originalOptOutAt);
    expect(lead.whatsapp_opt_out_source).toBe("previous_stop");
    expect(await WhatsAppConsentEvent.count()).toBe(1);
  });

  test("records an explicit, evidenced opt-in without supporting automatic START", async () => {
    const lead = await Lead.create({
      name: "Explicit Opt-in",
      phone: "+50934000001",
      whatsapp_opt_out_at: new Date()
    });
    const eventAt = new Date("2026-07-14T18:00:00.000Z");

    await recordExplicitOptIn({
      contact: lead,
      contactType: "lead",
      source: "signed_form",
      eventAt,
      externalEvidence: { reference: "fictional-form-123" },
      context: { purpose: "marketing reminders" }
    });

    await lead.reload();
    expect(lead.whatsapp_opt_in).toBe(true);
    expect(lead.whatsapp_opt_in_at).toEqual(eventAt);
    expect(lead.whatsapp_opt_out_at).toBeNull();
    const consent = await WhatsAppConsentEvent.findOne();
    expect(consent.action).toBe("opt_in");
    expect(consent.source).toBe("signed_form");
    expect(consent.evidence_json).toContain("fictional-form-123");
  });

  test("stores an unmatched inbound message without creating a contact", async () => {
    const response = await postPayload(
      inboundPayload([inboundMessage({ from: "50939999999", text: "Qui est la?" })])
    );

    expect(response.status).toBe(200);
    expect(await Lead.count()).toBe(0);
    expect(await Student.count()).toBe(0);
    const message = await Message.findOne();
    expect(message.lead_id).toBeNull();
    expect(message.student_id).toBeNull();
    expect(message.source_phone).toBe("50939999999");
    const event = await WhatsAppWebhookEvent.findOne();
    expect(event.messages_unmatched).toBe(1);
    expect(event.state).toBe("processed");
  });

  test("rejects an invalid timestamp without writing Invalid Date", async () => {
    await createOptedInLead();
    const response = await postPayload(
      inboundPayload([inboundMessage({ timestamp: "invalid-timestamp" })])
    );

    expect(response.status).toBe(200);
    expect(await Message.count()).toBe(0);
    const event = await WhatsAppWebhookEvent.findOne();
    expect(event.messages_failed).toBe(1);
    expect(event.state).toBe("failed");
  });

  test("marks a valid plus invalid inbound payload partially processed", async () => {
    await createOptedInLead();
    const response = await postPayload(
      inboundPayload([
        inboundMessage({ id: "wamid.partial-valid", text: "Valide" }),
        inboundMessage({ id: "wamid.partial-invalid", timestamp: "invalid" })
      ])
    );

    expect(response.status).toBe(200);
    expect(await Message.count()).toBe(1);
    const event = await WhatsAppWebhookEvent.findOne();
    expect(event.messages_matched).toBe(1);
    expect(event.messages_failed).toBe(1);
    expect(event.state).toBe("partially_processed");
  });

  test("blocks follow-up, recovery, group, and helper sends after opt-out", async () => {
    process.env.WHATSAPP_SEND_ENABLED = "true";
    const optedOutAt = new Date();
    const lead = await createOptedInLead({ whatsapp_opt_out_at: optedOutAt });
    const followUp = await FollowUp.create({
      lead_id: lead.id,
      scheduled_date: new Date(Date.now() - 1000),
      message: "Do not send",
      status: "pending"
    });
    const student = await Student.create({
      name: "Opted-out Recovery",
      phone: "+50934000002",
      status: "at_risk",
      whatsapp_opt_in: true,
      whatsapp_opt_in_at: new Date("2026-07-01T10:00:00.000Z"),
      whatsapp_opt_out_at: optedOutAt
    });

    const activationSendSpy = jest.spyOn(activationWhatsappService, "sendMessage");
    const followUpResult = await leadWhatsappService.processPendingFollowups();
    const recoveryResult = await activationAutomationService.triggerStudentRecovery(student);
    const helperResult = await leadWhatsappService.sendWhatsAppTemplate(lead, "Test");

    const group = await groupService.createGroup({ name: "Opt-out Test" });
    await groupService.addMember({ groupId: group.id, contactType: "lead", contactId: lead.id });
    const preview = await groupService.sendMessage({
      groupId: group.id,
      messageTemplate: "Bonjour {{name}}",
      dryRun: true
    });
    const leadSendSpy = jest.spyOn(leadWhatsappService, "sendWhatsAppMessage");
    const groupResult = await groupService.sendMessage({
      groupId: group.id,
      messageTemplate: "Bonjour {{name}}",
      dryRun: false,
      token: preview.preview_token
    });

    await followUp.reload();
    expect(followUpResult.skipped_opt_out).toBe(1);
    expect(followUp.status).toBe("needs_review");
    expect(followUp.cancelled).toBe(true);
    expect(recoveryResult.status).toBe("skipped_opt_out");
    expect(activationSendSpy).not.toHaveBeenCalled();
    expect(helperResult.status).toBe("skipped_opt_out");
    expect(groupResult.skipped_opt_out).toBe(1);
    expect(groupResult.results[0].status).toBe("skipped_opt_out");
    expect(leadSendSpy).not.toHaveBeenCalled();
  });
});
