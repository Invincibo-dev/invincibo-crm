const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const request = require("supertest");

process.env.NODE_ENV = "test";
process.env.DB_DIALECT = "sqlite";
process.env.DB_STORAGE = ":memory:";
process.env.JWT_SECRET = "followup_recovery_jwt_secret";
process.env.WHATSAPP_APP_SECRET = "followup_recovery_meta_secret";
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "followup_recovery_verify";
process.env.FOLLOWUP_PROCESSING_TIMEOUT_MINUTES = "15";
process.env.FOLLOWUP_RECOVERY_BATCH_SIZE = "2";
process.env.FOLLOWUP_MAX_ATTEMPTS = "3";
process.env.API_RATE_LIMIT_MAX = "100000";

const app = require("../app");
const { AuditLog, FollowUp, Lead, Message, User, sequelize } = require("../models");
const {
  findStuckFollowUps,
  recoverStuckBatch,
  recoverStuckFollowUp
} = require("../services/followupRecoveryService");

const NOW = new Date("2026-07-15T12:00:00.000Z");
const OLD = new Date(NOW.getTime() - 60 * 60 * 1000);
const RECENT = new Date(NOW.getTime() - 5 * 60 * 1000);

const createActor = async (role = "admin") => {
  const user = await User.create({
    name: `${role} recovery`,
    email: `${role}-${crypto.randomUUID()}@crm.local`,
    password_hash: "not-used-in-this-test",
    role
  });
  const token = jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET
  );
  return { user, token, auth: { Authorization: `Bearer ${token}` } };
};

const createLead = (overrides = {}) =>
  Lead.create({
    name: "Recovery Lead",
    phone: `509${Math.floor(10000000 + Math.random() * 89999999)}`,
    whatsapp_opt_in: true,
    whatsapp_opt_in_at: new Date("2026-07-01T10:00:00.000Z"),
    ...overrides
  });

const createProcessing = async (overrides = {}) => {
  const lead = overrides.lead || (await createLead());
  const followUp = await FollowUp.create({
    lead_id: lead.id,
    scheduled_date: OLD,
    message: "Recovery test",
    status: "processing",
    processing_started_at: OLD,
    attempt_count: 1,
    delivery_evidence: "ambiguous",
    ...overrides,
    lead: undefined
  });
  return { lead, followUp };
};

const createDelivery = (followUp, lead, status, wamid = `wamid.${status}.${crypto.randomUUID()}`) =>
  Message.create({
    lead_id: lead.id,
    followup_id: followUp.id,
    message: "Recovery delivery",
    type: "followup",
    status,
    meta_status: status,
    meta_message_id: wamid,
    [`${status}_at`]: OLD
  });

const signedStatusPost = (wamid, status = "delivered") => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [{ id: wamid, status, timestamp: String(Math.floor(NOW.getTime() / 1000)) }]
            }
          }
        ]
      }
    ]
  };
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", process.env.WHATSAPP_APP_SECRET)
    .update(Buffer.from(body))
    .digest("hex");
  return request(app)
    .post("/api/webhooks/whatsapp")
    .set("Content-Type", "application/json")
    .set("X-Hub-Signature-256", `sha256=${signature}`)
    .send(body);
};

describe("stuck FollowUp recovery and manual review", () => {
  beforeAll(async () => {
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await sequelize.truncate({ cascade: true, restartIdentity: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test("selects old processing rows but not recent ones", async () => {
    const old = await createProcessing();
    await createProcessing({ processing_started_at: RECENT });

    const result = await findStuckFollowUps({ now: NOW, limit: 10 });

    expect(result.rows.map((row) => row.id)).toEqual([old.followUp.id]);
  });

  test("supports pages, chunks, and a strict batch limit", async () => {
    const rows = [];
    for (let index = 0; index < 5; index += 1) {
      rows.push(await createProcessing({ delivery_evidence: "no_meta_request" }));
    }

    const page = await findStuckFollowUps({ now: NOW, page: 2, limit: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0].id).toBe(rows[2].followUp.id);

    const summary = await recoverStuckBatch({ now: NOW, limit: 3 });
    expect(summary.scanned).toBe(3);
    expect(summary.returned_to_pending).toBe(3);
    expect(await FollowUp.count({ where: { status: "processing" } })).toBe(2);
  });

  test.each([
    ["delivered", "completed"],
    ["read", "completed"],
    ["failed", "failed"]
  ])("reconciles terminal Meta status %s to %s", async (metaStatus, expectedStatus) => {
    const { lead, followUp } = await createProcessing();
    await createDelivery(followUp, lead, metaStatus);

    const result = await recoverStuckFollowUp(followUp.id, { now: NOW });

    await followUp.reload();
    expect(result.action).toBe(expectedStatus);
    expect(followUp.status).toBe(expectedStatus);
    expect(await AuditLog.count({ where: { entity_id: followUp.id } })).toBe(1);
  });

  test("moves wamid without terminal status to needs_review", async () => {
    const { followUp } = await createProcessing({ provider_message_id: "wamid.awaiting-status" });

    const result = await recoverStuckFollowUp(followUp.id, { now: NOW });

    await followUp.reload();
    expect(result.reason).toBe("meta_status_missing_after_timeout");
    expect(followUp.status).toBe("needs_review");
    expect(followUp.provider_message_id).toBe("wamid.awaiting-status");
  });

  test("moves ambiguous result without wamid to needs_review", async () => {
    const { followUp } = await createProcessing({ delivery_evidence: "meta_request_started" });

    const result = await recoverStuckFollowUp(followUp.id, { now: NOW });

    await followUp.reload();
    expect(result.reason).toBe("ambiguous_delivery_result");
    expect(followUp.review_reason).toBe("ambiguous_delivery_result");
  });

  test("returns to pending only with durable proof that Meta was not called", async () => {
    const { followUp } = await createProcessing({
      delivery_evidence: "no_meta_request",
      processing_started_at: new Date("2020-01-01T00:00:00.000Z")
    });

    const result = await recoverStuckFollowUp(followUp.id, { now: NOW });

    await followUp.reload();
    expect(result.action).toBe("returned_to_pending");
    expect(followUp.status).toBe("pending");
    expect(followUp.attempt_count).toBe(0);
    expect(followUp.delivery_evidence).toBeNull();
  });

  test("never returns an opted-out contact to pending", async () => {
    const lead = await createLead({ whatsapp_opt_out_at: new Date() });
    const { followUp } = await createProcessing({ lead, delivery_evidence: "no_meta_request" });

    const result = await recoverStuckFollowUp(followUp.id, { now: NOW });

    await followUp.reload();
    expect(result.reason).toBe("contact_opted_out");
    expect(followUp.status).toBe("needs_review");
    expect(followUp.cancelled).toBe(true);
  });

  test("routes maximum attempts to review instead of pending", async () => {
    const { followUp } = await createProcessing({
      attempt_count: 3,
      delivery_evidence: "no_meta_request"
    });

    const result = await recoverStuckFollowUp(followUp.id, { now: NOW });

    expect(result.reason).toBe("maximum_attempts_reached");
    expect((await followUp.reload()).status).toBe("needs_review");
  });

  test.each(["completed", "failed"])("never regresses terminal state %s", async (status) => {
    const lead = await createLead();
    const followUp = await FollowUp.create({
      lead_id: lead.id,
      scheduled_date: OLD,
      message: "terminal",
      status
    });

    const result = await recoverStuckFollowUp(followUp.id, { now: NOW });

    expect(result.action).toBe("ignored");
    expect((await followUp.reload()).status).toBe(status);
    expect(await AuditLog.count()).toBe(0);
  });

  test("dry-run API changes nothing and JWT/admin role are required", async () => {
    const { followUp } = await createProcessing({
      delivery_evidence: "no_meta_request",
      processing_started_at: new Date("2020-01-01T00:00:00.000Z")
    });
    const admin = await createActor("admin");
    const agent = await createActor("agent");

    expect(
      (await request(app).post("/api/followups/recovery/run").send({ dry_run: true })).status
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/followups/recovery/run")
          .set(agent.auth)
          .send({ dry_run: true })
      ).status
    ).toBe(403);
    const response = await request(app)
      .post("/api/followups/recovery/run")
      .set(admin.auth)
      .send({ dry_run: true, limit: 1 });

    expect(response.status).toBe(200);
    expect(response.body.dry_run).toBe(true);
    expect(response.body.result.returned_to_pending).toBe(1);
    expect((await followUp.reload()).status).toBe("processing");
    expect(await AuditLog.count()).toBe(0);
  });

  test("review list is paginated and restricted to admin", async () => {
    const admin = await createActor("admin");
    const agent = await createActor("agent");
    const first = await createProcessing({ status: "needs_review", review_reason: "ambiguous" });
    await createProcessing({ status: "needs_review", review_reason: "ambiguous" });

    expect((await request(app).get("/api/followups/review").set(agent.auth)).status).toBe(403);
    const response = await request(app)
      .get("/api/followups/review")
      .set(admin.auth)
      .query({ page: 1, limit: 1 });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination.total).toBe(2);
    expect(response.body.data[0]).toHaveProperty("system_recommendation");
    expect(response.body.data[0]).toHaveProperty("return_to_pending_allowed");
    expect(first.followUp.id).toBeTruthy();
  });

  test("manual review requires a note and creates one actor audit", async () => {
    const admin = await createActor("admin");
    const { followUp } = await createProcessing({ status: "needs_review" });
    const url = `/api/followups/${followUp.id}/review`;

    expect(
      (await request(app).patch(url).set(admin.auth).send({ decision: "mark_completed", note: "" }))
        .status
    ).toBe(400);
    const first = await request(app)
      .patch(url)
      .set(admin.auth)
      .send({ decision: "mark_completed", note: "Verified outside Meta" });
    const repeated = await request(app)
      .patch(url)
      .set(admin.auth)
      .send({ decision: "mark_completed", note: "Repeated request" });

    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(repeated.body.idempotent).toBe(true);
    await followUp.reload();
    expect(followUp.status).toBe("completed");
    expect(followUp.reviewed_by).toBe(admin.user.id);
    expect(followUp.review_note).toBe("Verified outside Meta");
    expect(await AuditLog.count({ where: { action: "FOLLOWUP_MANUAL_REVIEW" } })).toBe(1);
  });

  test("manual return_to_pending rejects wamid ambiguity and opt-out", async () => {
    const admin = await createActor("admin");
    const withWamid = await createProcessing({
      status: "needs_review",
      provider_message_id: "wamid.manual-ambiguous",
      delivery_evidence: "no_meta_request"
    });
    const optedOutLead = await createLead({ whatsapp_opt_out_at: new Date() });
    const optedOut = await createProcessing({
      lead: optedOutLead,
      status: "needs_review",
      delivery_evidence: "no_meta_request"
    });

    for (const id of [withWamid.followUp.id, optedOut.followUp.id]) {
      const response = await request(app)
        .patch(`/api/followups/${id}/review`)
        .set(admin.auth)
        .send({ decision: "return_to_pending", note: "Try return" });
      expect(response.status).toBe(409);
    }
    expect((await withWamid.followUp.reload()).status).toBe("needs_review");
    expect((await optedOut.followUp.reload()).status).toBe("needs_review");
  });

  test("manual return_to_pending succeeds only for confirmed no-send evidence", async () => {
    const admin = await createActor("admin");
    const { followUp } = await createProcessing({
      status: "needs_review",
      delivery_evidence: "no_meta_request"
    });

    const response = await request(app)
      .patch(`/api/followups/${followUp.id}/review`)
      .set(admin.auth)
      .send({ decision: "return_to_pending", note: "No Meta request verified" });

    expect(response.status).toBe(200);
    await followUp.reload();
    expect(followUp.status).toBe("pending");
    expect(followUp.attempt_count).toBe(0);
  });

  test("two concurrent batches remain idempotent", async () => {
    const { followUp } = await createProcessing({ delivery_evidence: "no_meta_request" });

    await Promise.all([
      recoverStuckBatch({ now: NOW, limit: 10 }),
      recoverStuckBatch({ now: NOW, limit: 10 })
    ]);

    expect((await followUp.reload()).status).toBe("pending");
    expect(await AuditLog.count({ where: { entity_id: followUp.id } })).toBe(1);
  });

  test("a late delivered webhook after recovery wins without regression", async () => {
    const wamid = "wamid.recovery-race";
    const { lead, followUp } = await createProcessing({
      provider_message_id: wamid,
      delivery_evidence: "meta_accepted"
    });
    await Message.create({
      lead_id: lead.id,
      followup_id: followUp.id,
      message: "race",
      type: "followup",
      status: "accepted",
      meta_status: "accepted",
      meta_message_id: wamid,
      accepted_at: OLD
    });

    const recovery = await recoverStuckFollowUp(followUp.id, { now: NOW });
    const webhook = await signedStatusPost(wamid);

    expect(webhook.status).toBe(200);
    await followUp.reload();
    expect(followUp.status).toBe("completed");
    expect(["needs_review", "ignored"]).toContain(recovery.action);
  });

  test("repeated recovery does not duplicate audit", async () => {
    const { followUp } = await createProcessing({ delivery_evidence: "no_meta_request" });

    await recoverStuckFollowUp(followUp.id, { now: NOW });
    const second = await recoverStuckFollowUp(followUp.id, { now: NOW });

    expect(second.action).toBe("ignored");
    expect(await AuditLog.count({ where: { entity_id: followUp.id } })).toBe(1);
  });
});
