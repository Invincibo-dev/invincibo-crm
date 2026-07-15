const crypto = require("crypto");
const request = require("supertest");

process.env.NODE_ENV = "test";
process.env.DB_DIALECT = "sqlite";
process.env.DB_STORAGE = ":memory:";
process.env.WHATSAPP_APP_SECRET = "test_meta_app_secret";
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "test_webhook_verify_token";
process.env.API_RATE_LIMIT_MAX = "100000";

const app = require("../app");
const { FollowUp, Lead, Message, Student, WhatsAppWebhookEvent, sequelize } = require("../models");
const { safeBufferEqual } = require("../services/whatsappWebhookService");

const sign = (body, secret = process.env.WHATSAPP_APP_SECRET) =>
  `sha256=${crypto.createHmac("sha256", secret).update(Buffer.from(body)).digest("hex")}`;

const statusPayload = (status = "delivered") => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba-test",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            statuses: [
              {
                id: "wamid.test-status-1",
                status,
                timestamp: "1784080000",
                recipient_id: "50934000001"
              }
            ]
          }
        }
      ]
    }
  ]
});

const postSigned = (rawBody, signature = sign(rawBody)) =>
  request(app)
    .post("/api/webhooks/whatsapp")
    .set("Content-Type", "application/json")
    .set("X-Hub-Signature-256", signature)
    .send(rawBody);

describe("WhatsApp Meta webhook security", () => {
  beforeAll(async () => {
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    process.env.WHATSAPP_APP_SECRET = "test_meta_app_secret";
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "test_webhook_verify_token";
    await sequelize.truncate({ cascade: true, restartIdentity: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe("GET verification", () => {
    test("returns the exact challenge for a valid subscription", async () => {
      const response = await request(app).get("/api/webhooks/whatsapp").query({
        "hub.mode": "subscribe",
        "hub.verify_token": "test_webhook_verify_token",
        "hub.challenge": "challenge-12345"
      });

      expect(response.status).toBe(200);
      expect(response.text).toBe("challenge-12345");
    });

    test("rejects an incorrect verify token", async () => {
      const response = await request(app).get("/api/webhooks/whatsapp").query({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong-token",
        "hub.challenge": "challenge"
      });

      expect(response.status).toBe(403);
      expect(response.text).not.toContain(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN);
    });

    test("rejects an incorrect mode", async () => {
      const response = await request(app).get("/api/webhooks/whatsapp").query({
        "hub.mode": "unsubscribe",
        "hub.verify_token": "test_webhook_verify_token",
        "hub.challenge": "challenge"
      });

      expect(response.status).toBe(403);
    });

    test("returns 400 when required parameters are missing", async () => {
      const response = await request(app)
        .get("/api/webhooks/whatsapp")
        .query({ "hub.mode": "subscribe" });

      expect(response.status).toBe(400);
    });
  });

  describe("POST signature and receipt", () => {
    test("uses the exact raw body, verifies the signature, and stores one receipt", async () => {
      const rawBody = JSON.stringify(statusPayload(), null, 2);
      const response = await postSigned(rawBody);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
      const event = await WhatsAppWebhookEvent.findOne();
      expect(event).toBeTruthy();
      expect(event.event_key).toBe("status:wamid.test-status-1:delivered:1784080000");
      expect(event.event_type).toBe("status");
      expect(event.meta_message_id).toBe("wamid.test-status-1");
      expect(event.payload_json).toBe(rawBody);
      expect(event.state).toBe("ignored");
      expect(event.signature_verified).toBe(true);
      expect(event.unmatched_count).toBe(1);
      expect(event.processed_at).toBeTruthy();
    });

    test("rejects a missing signature", async () => {
      const response = await request(app)
        .post("/api/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .send(JSON.stringify(statusPayload()));

      expect(response.status).toBe(401);
      expect(await WhatsAppWebhookEvent.count()).toBe(0);
    });

    test("rejects a malformed signature", async () => {
      const rawBody = JSON.stringify(statusPayload());
      const response = await postSigned(rawBody, "md5=abcd");

      expect(response.status).toBe(401);
      expect(await WhatsAppWebhookEvent.count()).toBe(0);
    });

    test("rejects an invalid signature without exposing it", async () => {
      const rawBody = JSON.stringify(statusPayload());
      const invalid = `sha256=${"0".repeat(64)}`;
      const response = await postSigned(rawBody, invalid);

      expect(response.status).toBe(401);
      expect(response.text).not.toContain(invalid);
      expect(await WhatsAppWebhookEvent.count()).toBe(0);
    });

    test("rejects a payload changed after the signature was calculated", async () => {
      const original = JSON.stringify(statusPayload("sent"));
      const modified = JSON.stringify(statusPayload("read"));
      const response = await postSigned(modified, sign(original));

      expect(response.status).toBe(401);
      expect(await WhatsAppWebhookEvent.count()).toBe(0);
    });

    test("accepts a valid duplicate quickly without creating another row", async () => {
      const rawBody = JSON.stringify(statusPayload());
      const first = await postSigned(rawBody);
      const startedAt = Date.now();
      const duplicate = await postSigned(rawBody);
      const elapsedMs = Date.now() - startedAt;

      expect(first.status).toBe(200);
      expect(duplicate.status).toBe(200);
      expect(duplicate.body).toEqual({ received: true });
      expect(await WhatsAppWebhookEvent.count()).toBe(1);
      expect(elapsedMs).toBeLessThan(1000);
    });

    test("updates only the matching delivery entities when receiving a status payload", async () => {
      const lead = await Lead.create({ name: "Untouched Lead", phone: "+50934000020" });
      const student = await Student.create({ name: "Untouched Student", phone: "+50934000021" });
      const followUp = await FollowUp.create({
        lead_id: lead.id,
        scheduled_date: new Date(),
        message: "existing follow-up",
        status: "processing"
      });
      const message = await Message.create({
        lead_id: lead.id,
        followup_id: followUp.id,
        message: "existing message",
        type: "followup",
        status: "accepted",
        meta_message_id: "wamid.test-status-1"
      });
      await Promise.all([lead.reload(), student.reload(), followUp.reload(), message.reload()]);
      const before = {
        lead: lead.toJSON(),
        student: student.toJSON(),
        followUp: followUp.toJSON(),
        message: message.toJSON()
      };

      const response = await postSigned(JSON.stringify(statusPayload()));

      expect(response.status).toBe(200);
      await Promise.all([lead.reload(), student.reload(), followUp.reload(), message.reload()]);
      expect(lead.toJSON()).toEqual(before.lead);
      expect(student.toJSON()).toEqual(before.student);
      expect(followUp.status).toBe("completed");
      expect(followUp.meta_status).toBe("delivered");
      expect(message.status).toBe("delivered");
      expect(message.meta_status).toBe("delivered");
      expect(message.delivered_at).toBeTruthy();
      expect(message.toJSON()).not.toEqual(before.message);
      expect(await WhatsAppWebhookEvent.count()).toBe(1);
    });

    test("handles different signature lengths without throwing", async () => {
      expect(safeBufferEqual(Buffer.alloc(32), Buffer.alloc(31))).toBe(false);
      const rawBody = JSON.stringify(statusPayload());
      const response = await postSigned(rawBody, `sha256=${"a".repeat(62)}`);

      expect(response.status).toBe(401);
    });

    test("prevents processing when the app secret is missing", async () => {
      const rawBody = JSON.stringify(statusPayload());
      const signature = sign(rawBody);
      delete process.env.WHATSAPP_APP_SECRET;

      const response = await postSigned(rawBody, signature);

      expect(response.status).toBe(503);
      expect(await WhatsAppWebhookEvent.count()).toBe(0);
    });
  });
});
