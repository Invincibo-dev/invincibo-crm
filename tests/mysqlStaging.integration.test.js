const crypto = require("crypto");
const request = require("supertest");
const { Op } = require("sequelize");

jest.mock("axios", () => jest.fn());

const assertSafeStaging = () => {
  if (process.env.NODE_ENV !== "staging" || process.env.DB_DIALECT !== "mysql") {
    throw new Error("MySQL staging tests require NODE_ENV=staging and DB_DIALECT=mysql");
  }
  if (process.env.MYSQL_STAGING_CONFIRM !== "STAGING_ONLY") {
    throw new Error("MYSQL_STAGING_CONFIRM=STAGING_ONLY is required");
  }
  if (!/(staging|stage|test)/i.test(String(process.env.DB_NAME || ""))) {
    throw new Error("Refusing a database without staging, stage, or test in its name");
  }
  if (
    process.env.WHATSAPP_SEND_ENABLED !== "false" ||
    process.env.FOLLOWUP_CRON_ENABLED !== "false"
  ) {
    throw new Error("WhatsApp sending and follow-up cron must both be disabled");
  }
};

assertSafeStaging();
process.env.WHATSAPP_APP_SECRET = "STAGING_TEST_fictitious_app_secret";
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "STAGING_TEST_fictitious_verify_token";
process.env.API_RATE_LIMIT_MAX = "100000";
process.env.FOLLOWUP_PROCESSING_TIMEOUT_MINUTES = "15";
process.env.FOLLOWUP_RECOVERY_BATCH_SIZE = "20";
process.env.FOLLOWUP_MAX_ATTEMPTS = "3";

const axios = require("axios");
const app = require("../app");
const runtimeState = require("../config/runtimeState");
const {
  AuditLog,
  FollowUp,
  Lead,
  Message,
  Student,
  User,
  WhatsAppConsentEvent,
  WhatsAppWebhookEvent,
  sequelize
} = require("../models");
const { processPendingFollowups, sendWhatsAppTemplate } = require("../services/whatsappService");
const {
  recoverStuckBatch,
  recoverStuckFollowUp,
  reviewFollowUp
} = require("../services/followupRecoveryService");

const RUN_PREFIX = `STAGING_TEST_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const OLD = new Date(Date.now() - 60 * 60 * 1000);
let sequence = 0;

const nextPhone = () => {
  sequence += 1;
  return `5099${String(Date.now()).slice(-7)}${String(sequence).padStart(2, "0")}`;
};

const createLead = (overrides = {}) =>
  Lead.create({
    name: `${RUN_PREFIX}_LEAD_${++sequence}`,
    phone: nextPhone(),
    whatsapp_opt_in: true,
    whatsapp_opt_in_at: new Date(),
    whatsapp_opt_in_source: "staging_test",
    ...overrides
  });

const createStudent = (overrides = {}) =>
  Student.create({
    name: `${RUN_PREFIX}_STUDENT_${++sequence}`,
    phone: nextPhone(),
    whatsapp_opt_in: true,
    whatsapp_opt_in_at: new Date(),
    whatsapp_opt_in_source: "staging_test",
    ...overrides
  });

const createFollowUp = async (overrides = {}) => {
  const lead = overrides.lead || (await createLead());
  const followUp = await FollowUp.create({
    lead_id: lead.id,
    scheduled_date: OLD,
    message: `${RUN_PREFIX}_FOLLOWUP_${++sequence}`,
    status: "pending",
    ...overrides,
    lead: undefined
  });
  return { lead, followUp };
};

const sign = (body) =>
  `sha256=${crypto
    .createHmac("sha256", process.env.WHATSAPP_APP_SECRET)
    .update(Buffer.from(body))
    .digest("hex")}`;

const postPayload = (payload) => {
  const body = JSON.stringify(payload);
  return request(app)
    .post("/api/webhooks/whatsapp")
    .set("Content-Type", "application/json")
    .set("X-Hub-Signature-256", sign(body))
    .send(body);
};

const statusPayload = (wamid, status, timestamp) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: `${RUN_PREFIX}_WABA`,
      changes: [
        {
          field: "messages",
          value: { statuses: [{ id: wamid, status, timestamp: String(timestamp) }] }
        }
      ]
    }
  ]
});

const inboundPayload = ({ wamid, phone, text = "STOP", timestamp }) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: `${RUN_PREFIX}_WABA`,
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            contacts: [{ profile: { name: RUN_PREFIX }, wa_id: phone }],
            messages: [
              {
                from: phone,
                id: wamid,
                timestamp: String(timestamp),
                type: "text",
                text: { body: text }
              }
            ]
          }
        }
      ]
    }
  ]
});

const cleanup = async () => {
  const like = `${RUN_PREFIX}%`;
  const followUps = await FollowUp.findAll({
    attributes: ["id"],
    where: { message: { [Op.like]: like } },
    raw: true
  });
  const followUpIds = followUps.map(({ id }) => id);
  const users = await User.findAll({
    attributes: ["id"],
    where: { email: { [Op.like]: `${RUN_PREFIX.toLowerCase()}%` } },
    raw: true
  });
  const userIds = users.map(({ id }) => id);

  if (followUpIds.length) {
    await AuditLog.destroy({ where: { entity: "followup", entity_id: followUpIds } });
  }
  await WhatsAppConsentEvent.destroy({
    where: { meta_message_id: { [Op.like]: `wamid.${like}` } }
  });
  await Message.destroy({
    where: {
      [Op.or]: [
        { message: { [Op.like]: like } },
        { meta_message_id: { [Op.like]: `wamid.${like}` } }
      ]
    }
  });
  await WhatsAppWebhookEvent.destroy({
    where: {
      [Op.or]: [
        { event_key: { [Op.like]: `%${RUN_PREFIX}%` } },
        { meta_message_id: { [Op.like]: `wamid.${like}` } }
      ]
    }
  });
  if (followUpIds.length) await FollowUp.destroy({ where: { id: followUpIds } });
  await Student.destroy({ where: { name: { [Op.like]: like } } });
  await Lead.destroy({ where: { name: { [Op.like]: like } } });
  if (userIds.length) await User.destroy({ where: { id: userIds } });
};

describe("MySQL staging WhatsApp critical behavior", () => {
  beforeAll(async () => {
    await sequelize.authenticate();
    runtimeState.markReady();
  });

  afterAll(async () => {
    await cleanup();
    runtimeState.markNotReady();
    await sequelize.close();
  });

  test("creates Lead, Student, Message and FollowUp with normalized phones", async () => {
    const lead = await createLead();
    const student = await createStudent();
    const { followUp } = await createFollowUp({ lead });
    const message = await Message.create({
      lead_id: lead.id,
      followup_id: followUp.id,
      message: `${RUN_PREFIX}_MESSAGE`,
      type: "followup",
      status: "accepted",
      meta_status: "accepted",
      meta_message_id: `wamid.${RUN_PREFIX}.create`
    });

    expect(lead.whatsapp_phone_normalized).toMatch(/^509/);
    expect(student.whatsapp_phone_normalized).toMatch(/^509/);
    expect(message.followup_id).toBe(followUp.id);
  });

  test("claims a pending FollowUp exactly once across concurrent updates", async () => {
    const { followUp } = await createFollowUp();
    const claim = () =>
      FollowUp.update(
        {
          status: "processing",
          processing_started_at: new Date(),
          attempt_count: sequelize.literal("attempt_count + 1"),
          delivery_evidence: "no_meta_request"
        },
        { where: { id: followUp.id, status: "pending", cancelled: false } }
      );

    const results = await Promise.all([claim(), claim()]);
    expect(results.reduce((sum, [count]) => sum + count, 0)).toBe(1);
    await followUp.reload();
    expect(followUp.status).toBe("processing");
    expect(followUp.attempt_count).toBe(1);
  });

  test("deduplicates two simultaneous webhook receipts", async () => {
    const wamid = `wamid.${RUN_PREFIX}.duplicate`;
    const payload = statusPayload(wamid, "sent", Math.floor(Date.now() / 1000));
    const responses = await Promise.all([postPayload(payload), postPayload(payload)]);

    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    expect(await WhatsAppWebhookEvent.count({ where: { meta_message_id: wamid } })).toBe(1);
  });

  test("processes sent to delivered to read without regression", async () => {
    const { lead, followUp } = await createFollowUp({
      status: "processing",
      processing_started_at: OLD,
      delivery_evidence: "meta_accepted"
    });
    const wamid = `wamid.${RUN_PREFIX}.lifecycle`;
    followUp.provider_message_id = wamid;
    followUp.meta_status = "accepted";
    followUp.accepted_at = OLD;
    await followUp.save();
    const message = await Message.create({
      lead_id: lead.id,
      followup_id: followUp.id,
      message: `${RUN_PREFIX}_LIFECYCLE`,
      type: "followup",
      status: "accepted",
      meta_status: "accepted",
      meta_message_id: wamid,
      accepted_at: OLD
    });
    const base = Math.floor(Date.now() / 1000);

    for (const [offset, status] of [
      [0, "sent"],
      [1, "delivered"],
      [2, "read"]
    ]) {
      expect((await postPayload(statusPayload(wamid, status, base + offset))).status).toBe(200);
    }
    await Promise.all([message.reload(), followUp.reload()]);
    expect(message.meta_status).toBe("read");
    expect(message.sent_at).toBeTruthy();
    expect(message.delivered_at).toBeTruthy();
    expect(message.read_at).toBeTruthy();
    expect(followUp.status).toBe("completed");
  });

  test("applies STOP idempotently to one Lead and one Student", async () => {
    const lead = await createLead();
    const student = await createStudent();
    const timestamp = Math.floor(Date.now() / 1000);
    const leadWamid = `wamid.${RUN_PREFIX}.stop.lead`;
    const studentWamid = `wamid.${RUN_PREFIX}.stop.student`;
    const leadPayload = inboundPayload({
      wamid: leadWamid,
      phone: lead.whatsapp_phone_normalized,
      timestamp
    });
    const studentPayload = inboundPayload({
      wamid: studentWamid,
      phone: student.whatsapp_phone_normalized,
      timestamp: timestamp + 1
    });

    const leadResponses = await Promise.all([postPayload(leadPayload), postPayload(leadPayload)]);
    expect(leadResponses.map(({ status }) => status)).toEqual([200, 200]);
    expect((await postPayload(studentPayload)).status).toBe(200);
    await Promise.all([lead.reload(), student.reload()]);
    expect(lead.whatsapp_opt_in).toBe(false);
    expect(student.whatsapp_opt_in).toBe(false);
    expect(
      await WhatsAppConsentEvent.count({
        where: { meta_message_id: { [Op.in]: [leadWamid, studentWamid] }, action: "opt_out" }
      })
    ).toBe(2);
  });

  test("blocks opt-out and global-disabled sending before any Meta call", async () => {
    const lead = await createLead({ whatsapp_opt_out_at: new Date() });
    const direct = await sendWhatsAppTemplate(lead, "Test");
    const { followUp } = await createFollowUp({ lead });
    const batch = await processPendingFollowups();

    expect(direct.status).toBe("skipped_opt_out");
    expect(batch.disabled).toBe(true);
    expect(axios).not.toHaveBeenCalled();
    expect((await followUp.reload()).status).toBe("pending");
  });

  test("recovers a stuck FollowUp once across concurrent recovery batches", async () => {
    const { followUp } = await createFollowUp({
      status: "processing",
      processing_started_at: OLD,
      attempt_count: 1,
      delivery_evidence: "no_meta_request"
    });

    await Promise.all([
      recoverStuckBatch({ now: new Date(), limit: 20 }),
      recoverStuckBatch({ now: new Date(), limit: 20 })
    ]);
    await followUp.reload();
    expect(followUp.status).toBe("pending");
    expect(followUp.attempt_count).toBe(0);
    expect(await AuditLog.count({ where: { entity: "followup", entity_id: followUp.id } })).toBe(1);
  });

  test("lets a delivered webhook reconcile an ambiguous recovery", async () => {
    const { lead, followUp } = await createFollowUp({
      status: "processing",
      processing_started_at: OLD,
      attempt_count: 1,
      delivery_evidence: "meta_accepted"
    });
    const wamid = `wamid.${RUN_PREFIX}.recovery.race`;
    await followUp.update({ provider_message_id: wamid, meta_status: "accepted" });
    await Message.create({
      lead_id: lead.id,
      followup_id: followUp.id,
      message: `${RUN_PREFIX}_RECOVERY_RACE`,
      type: "followup",
      status: "accepted",
      meta_status: "accepted",
      meta_message_id: wamid
    });

    const [, webhook] = await Promise.all([
      recoverStuckFollowUp(followUp.id, { now: new Date() }),
      postPayload(statusPayload(wamid, "delivered", Math.floor(Date.now() / 1000)))
    ]);
    expect(webhook.status).toBe(200);
    await followUp.reload();
    expect(followUp.status).toBe("completed");
    expect(followUp.meta_status).toBe("delivered");
  });

  test("serializes two identical manual decisions and writes one audit", async () => {
    const user = await User.create({
      name: `${RUN_PREFIX}_ADMIN`,
      email: `${RUN_PREFIX.toLowerCase()}_${sequence}@example.test`,
      password_hash: "STAGING_TEST_not_a_real_hash",
      role: "admin"
    });
    const { followUp } = await createFollowUp({
      status: "needs_review",
      review_reason: "staging_concurrency"
    });
    const decide = () =>
      reviewFollowUp(followUp.id, "mark_completed", { id: user.id, role: "admin" }, RUN_PREFIX);
    const decisions = await Promise.all([decide(), decide()]);

    expect(decisions.filter(({ changed }) => changed)).toHaveLength(1);
    expect(decisions.filter(({ idempotent }) => idempotent)).toHaveLength(1);
    expect(await AuditLog.count({ where: { entity: "followup", entity_id: followUp.id } })).toBe(1);
  });

  test("rolls back all writes when a transaction fails", async () => {
    const marker = `${RUN_PREFIX}_ROLLBACK`;
    await expect(
      sequelize.transaction(async (transaction) => {
        await Lead.create({ name: marker, phone: nextPhone() }, { transaction });
        throw new Error("STAGING_TEST_forced_rollback");
      })
    ).rejects.toThrow("STAGING_TEST_forced_rollback");
    expect(await Lead.count({ where: { name: marker } })).toBe(0);
  });
});
