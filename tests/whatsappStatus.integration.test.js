const crypto = require("crypto");
const request = require("supertest");

process.env.NODE_ENV = "test";
process.env.DB_DIALECT = "sqlite";
process.env.DB_STORAGE = ":memory:";
process.env.WHATSAPP_APP_SECRET = "status_test_app_secret";
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "status_test_verify_token";
process.env.API_RATE_LIMIT_MAX = "100000";

const app = require("../app");
const { FollowUp, Lead, Message, WhatsAppWebhookEvent, sequelize } = require("../models");

const sign = (body) =>
  `sha256=${crypto
    .createHmac("sha256", process.env.WHATSAPP_APP_SECRET)
    .update(Buffer.from(body))
    .digest("hex")}`;

const payloadWith = (...statuses) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba-status-test",
      changes: [
        {
          field: "messages",
          value: { messaging_product: "whatsapp", statuses }
        }
      ]
    }
  ]
});

const metaStatus = (status, overrides = {}) => ({
  id: "wamid.status-test",
  status,
  timestamp: "1784080000",
  recipient_id: "50934000001",
  ...overrides
});

const postPayload = (payload) => {
  const body = JSON.stringify(payload);
  return request(app)
    .post("/api/webhooks/whatsapp")
    .set("Content-Type", "application/json")
    .set("X-Hub-Signature-256", sign(body))
    .send(body);
};

const createDelivery = async ({ wamid = "wamid.status-test", status = "accepted" } = {}) => {
  const phoneSuffix = crypto.createHash("sha256").update(wamid).digest("hex").slice(0, 10);
  const lead = await Lead.create({ name: "Status Contact", phone: `test-${phoneSuffix}` });
  const acceptedAt = new Date("2026-07-14T20:00:00.000Z");
  const followUp = await FollowUp.create({
    lead_id: lead.id,
    scheduled_date: acceptedAt,
    message: "Status test",
    status: "processing",
    provider_message_id: wamid,
    meta_status: status,
    accepted_at: acceptedAt
  });
  const message = await Message.create({
    lead_id: lead.id,
    followup_id: followUp.id,
    message: "Status test",
    type: "followup",
    status,
    meta_status: status,
    meta_message_id: wamid,
    accepted_at: acceptedAt
  });
  return { lead, followUp, message };
};

describe("WhatsApp Meta status processing", () => {
  beforeAll(async () => {
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await sequelize.truncate({ cascade: true, restartIdentity: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test("sent updates Message but keeps FollowUp processing", async () => {
    const { message, followUp } = await createDelivery();
    const response = await postPayload(payloadWith(metaStatus("sent")));

    expect(response.status).toBe(200);
    await Promise.all([message.reload(), followUp.reload()]);
    expect(message.meta_status).toBe("sent");
    expect(message.sent_at).toEqual(new Date(1784080000 * 1000));
    expect(followUp.meta_status).toBe("sent");
    expect(followUp.status).toBe("processing");
  });

  test("delivered completes FollowUp and preserves sent_at", async () => {
    const { message, followUp } = await createDelivery({ status: "sent" });
    const sentAt = new Date("2026-07-15T01:00:00.000Z");
    await Promise.all([message.update({ sent_at: sentAt }), followUp.update({ sent_at: sentAt })]);

    const response = await postPayload(payloadWith(metaStatus("delivered")));

    expect(response.status).toBe(200);
    await Promise.all([message.reload(), followUp.reload()]);
    expect(message.meta_status).toBe("delivered");
    expect(message.sent_at).toEqual(sentAt);
    expect(message.delivered_at).toEqual(new Date(1784080000 * 1000));
    expect(followUp.status).toBe("completed");
    expect(followUp.meta_status).toBe("delivered");
  });

  test("read after delivered enriches the completed delivery", async () => {
    const { message, followUp } = await createDelivery({ status: "delivered" });
    const deliveredAt = new Date("2026-07-15T01:30:00.000Z");
    await Promise.all([
      message.update({ delivered_at: deliveredAt }),
      followUp.update({ status: "completed", delivered_at: deliveredAt })
    ]);

    const response = await postPayload(
      payloadWith(metaStatus("read", { timestamp: "1784081000" }))
    );

    expect(response.status).toBe(200);
    await Promise.all([message.reload(), followUp.reload()]);
    expect(message.meta_status).toBe("read");
    expect(message.delivered_at).toEqual(deliveredAt);
    expect(message.read_at).toEqual(new Date(1784081000 * 1000));
    expect(followUp.status).toBe("completed");
    expect(followUp.meta_status).toBe("read");
  });

  test("failed stores useful Meta errors and fails FollowUp", async () => {
    const { message, followUp } = await createDelivery();
    const response = await postPayload(
      payloadWith(
        metaStatus("failed", {
          errors: [
            {
              code: 131026,
              title: "Message undeliverable",
              message: "Delivery failed",
              error_data: { details: "Recipient unavailable" }
            }
          ]
        })
      )
    );

    expect(response.status).toBe(200);
    await Promise.all([message.reload(), followUp.reload()]);
    expect(message.meta_status).toBe("failed");
    expect(message.meta_error_code).toBe("131026");
    expect(message.meta_error_message).toContain("Message undeliverable");
    expect(message.meta_error_message).toContain("Recipient unavailable");
    expect(followUp.status).toBe("failed");
    expect(followUp.failed_at).toBeTruthy();
  });

  test("a duplicate delivered event is idempotent", async () => {
    const { message } = await createDelivery();
    const payload = payloadWith(metaStatus("delivered"));

    expect((await postPayload(payload)).status).toBe(200);
    await message.reload();
    const firstUpdatedAt = message.updated_at;
    expect((await postPayload(payload)).status).toBe(200);
    await message.reload();

    expect(await WhatsAppWebhookEvent.count()).toBe(1);
    expect(await Message.count()).toBe(1);
    expect(await FollowUp.count()).toBe(1);
    expect(message.updated_at).toEqual(firstUpdatedAt);
    const event = await WhatsAppWebhookEvent.findOne();
    expect(event.processed_count).toBe(1);
    expect(event.state).toBe("processed");
  });

  test("late sent after delivered does not regress state", async () => {
    const { message, followUp } = await createDelivery({ status: "delivered" });
    const deliveredAt = new Date("2026-07-15T01:40:00.000Z");
    await Promise.all([
      message.update({ delivered_at: deliveredAt }),
      followUp.update({ status: "completed", delivered_at: deliveredAt })
    ]);

    expect(
      (await postPayload(payloadWith(metaStatus("sent", { timestamp: "1784070000" })))).status
    ).toBe(200);
    await Promise.all([message.reload(), followUp.reload()]);
    expect(message.meta_status).toBe("delivered");
    expect(message.delivered_at).toEqual(deliveredAt);
    expect(followUp.status).toBe("completed");
    expect((await WhatsAppWebhookEvent.findOne()).state).toBe("ignored");
  });

  test("late delivered after read does not regress state", async () => {
    const { message, followUp } = await createDelivery({ status: "read" });
    const readAt = new Date("2026-07-15T02:00:00.000Z");
    await Promise.all([
      message.update({ read_at: readAt }),
      followUp.update({ status: "completed", read_at: readAt })
    ]);

    expect((await postPayload(payloadWith(metaStatus("delivered")))).status).toBe(200);
    await Promise.all([message.reload(), followUp.reload()]);
    expect(message.meta_status).toBe("read");
    expect(message.read_at).toEqual(readAt);
    expect(followUp.meta_status).toBe("read");
  });

  test("processes several statuses across entries and changes", async () => {
    const first = await createDelivery({ wamid: "wamid.multi-1" });
    const second = await createDelivery({ wamid: "wamid.multi-2" });
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            { value: { statuses: [metaStatus("sent", { id: "wamid.multi-1" })] } },
            {
              value: {
                statuses: [
                  metaStatus("delivered", { id: "wamid.multi-1", timestamp: "1784080100" })
                ]
              }
            }
          ]
        },
        {
          changes: [
            {
              value: {
                statuses: [metaStatus("read", { id: "wamid.multi-2", timestamp: "1784080200" })]
              }
            }
          ]
        }
      ]
    };

    expect((await postPayload(payload)).status).toBe(200);
    await Promise.all([first.message.reload(), first.followUp.reload(), second.message.reload()]);
    expect(first.message.meta_status).toBe("delivered");
    expect(first.followUp.status).toBe("completed");
    expect(second.message.meta_status).toBe("read");
    const event = await WhatsAppWebhookEvent.findOne();
    expect(event.statuses_found).toBe(3);
    expect(event.processed_count).toBe(3);
    expect(event.state).toBe("processed");
  });

  test("an unknown wamid is audited without creating business rows", async () => {
    const response = await postPayload(
      payloadWith(metaStatus("delivered", { id: "wamid.unknown" }))
    );

    expect(response.status).toBe(200);
    expect(await Message.count()).toBe(0);
    expect(await FollowUp.count()).toBe(0);
    const event = await WhatsAppWebhookEvent.findOne();
    expect(event.unmatched_count).toBe(1);
    expect(event.state).toBe("ignored");
  });

  test("an identifiable FollowUp without Message is moved to needs_review", async () => {
    const lead = await Lead.create({ name: "Review Contact", phone: "+50934000002" });
    const followUp = await FollowUp.create({
      lead_id: lead.id,
      scheduled_date: new Date(),
      message: "Review test",
      status: "processing",
      provider_message_id: "wamid.review"
    });

    expect(
      (await postPayload(payloadWith(metaStatus("sent", { id: "wamid.review" })))).status
    ).toBe(200);
    await followUp.reload();
    expect(followUp.status).toBe("needs_review");
    expect(followUp.review_reason).toContain("without a matching Message");
    expect(await Message.count()).toBe(0);
  });

  test("an invalid timestamp is recorded without writing Invalid Date", async () => {
    const { message, followUp } = await createDelivery();
    const response = await postPayload(
      payloadWith(metaStatus("delivered", { timestamp: "not-a-timestamp" }))
    );

    expect(response.status).toBe(200);
    await Promise.all([message.reload(), followUp.reload()]);
    expect(message.meta_status).toBe("accepted");
    expect(message.delivered_at).toBeNull();
    expect(followUp.status).toBe("processing");
    const event = await WhatsAppWebhookEvent.findOne();
    expect(event.failed_count).toBe(1);
    expect(event.state).toBe("failed");
  });

  test("a missing timestamp uses receipt time and records the fallback", async () => {
    const { message } = await createDelivery();
    const status = metaStatus("sent");
    delete status.timestamp;

    expect((await postPayload(payloadWith(status))).status).toBe(200);
    await message.reload();
    expect(message.sent_at).toBeTruthy();
    const event = await WhatsAppWebhookEvent.findOne();
    expect(event.processing_summary_json).toContain('"timestamp_fallback":true');
  });

  test("a payload without statuses is acknowledged and ignored", async () => {
    const response = await postPayload({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { messages: [] } }] }]
    });

    expect(response.status).toBe(200);
    const event = await WhatsAppWebhookEvent.findOne();
    expect(event.statuses_found).toBe(0);
    expect(event.state).toBe("ignored");
  });

  test("a valid and an invalid status produce a partial result", async () => {
    const { message } = await createDelivery();
    const response = await postPayload(
      payloadWith(metaStatus("sent"), metaStatus("delivered", { timestamp: "invalid" }))
    );

    expect(response.status).toBe(200);
    await message.reload();
    expect(message.meta_status).toBe("sent");
    const event = await WhatsAppWebhookEvent.findOne();
    expect(event.statuses_found).toBe(2);
    expect(event.processed_count).toBe(1);
    expect(event.failed_count).toBe(1);
    expect(event.state).toBe("partially_processed");
    expect(await Message.count()).toBe(1);
    expect(await FollowUp.count()).toBe(1);
  });
});
