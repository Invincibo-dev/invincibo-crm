const request = require("supertest");
const bcrypt = require("bcryptjs");

process.env.API_RATE_LIMIT_MAX = "100000";
process.env.LOGIN_RATE_LIMIT_MAX = "100000";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret";
process.env.ADMIN_BOOTSTRAP_TOKEN = "test_bootstrap_secret";
process.env.TRACKING_SECRET = "test_tracking_secret";

const app = require("../app");
const {
  sequelize,
  User,
  Lead,
  Message,
  FollowUp,
  Student,
  StudentAction,
  TrackingEvent,
  Task,
  ContactGroupMember,
  WhatsAppConsentEvent
} = require("../models");
const trackingService = require("../services/activation/trackingService");
const { processPendingFollowups } = require("../services/whatsappService");

describe("Root CRM backend integration", () => {
  const expectJson = (response) => {
    expect(response.headers["content-type"]).toMatch(/application\/json/);
  };

  const createAdmin = async () => {
    return User.create({
      name: "Admin User",
      email: "admin@crm.local",
      password_hash: await bcrypt.hash("StrongPass123", 10),
      role: "admin"
    });
  };

  const loginAsAdmin = async () => {
    await createAdmin();
    const response = await request(app).post("/api/auth/login").send({
      email: "admin@crm.local",
      password: "StrongPass123"
    });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
    return response.body.token;
  };

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await sequelize.authenticate();
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe("AUTH", () => {
    test("POST /api/auth/register creates the first admin and returns a JWT", async () => {
      const response = await request(app)
        .post("/api/auth/register")
        .set("x-admin-bootstrap-token", process.env.ADMIN_BOOTSTRAP_TOKEN)
        .send({
          name: "Admin CRM",
          email: "admin@crm.local",
          password: "StrongPass123",
          role: "admin"
        });

      expect(response.status).toBe(201);
      expectJson(response);
      expect(response.body.token).toBeDefined();
      expect(response.body.user.email).toBe("admin@crm.local");
      expect(response.body.user.role).toBe("admin");
    });

    test("POST /api/auth/register rejects first-admin bootstrap without its secret", async () => {
      const response = await request(app).post("/api/auth/register").send({
        name: "Admin CRM",
        email: "admin@crm.local",
        password: "StrongPass123",
        role: "admin"
      });

      expect(response.status).toBe(403);
      expect(await User.count()).toBe(0);
    });

    test("POST /api/auth/register permits the bootstrap claim only once", async () => {
      const payload = {
        name: "Admin CRM",
        email: "admin@crm.local",
        password: "StrongPass123",
        role: "admin"
      };
      const first = await request(app)
        .post("/api/auth/register")
        .set("x-admin-bootstrap-token", process.env.ADMIN_BOOTSTRAP_TOKEN)
        .send(payload);
      const second = await request(app)
        .post("/api/auth/register")
        .set("x-admin-bootstrap-token", process.env.ADMIN_BOOTSTRAP_TOKEN)
        .send({ ...payload, email: "second@crm.local" });

      expect(first.status).toBe(201);
      expect(second.status).toBe(403);
      expect(await User.count()).toBe(1);
    });

    test("POST /api/auth/login accepts email/password and returns a JWT", async () => {
      await createAdmin();

      const response = await request(app).post("/api/auth/login").send({
        email: "admin@crm.local",
        password: "StrongPass123"
      });

      expect(response.status).toBe(200);
      expectJson(response);
      expect(response.body.token).toBeDefined();
      expect(response.body.user.email).toBe("admin@crm.local");
    });

    test("GET /api/auth/me returns the authenticated user", async () => {
      const token = await loginAsAdmin();

      const response = await request(app).get("/api/auth/me").set(auth(token));

      expect(response.status).toBe(200);
      expectJson(response);
      expect(response.body.email).toBe("admin@crm.local");
      expect(response.body.role).toBe("admin");
    });

    test("GET /api/auth/users returns users for admin", async () => {
      const token = await loginAsAdmin();

      const response = await request(app).get("/api/auth/users").set(auth(token));

      expect(response.status).toBe(200);
      expectJson(response);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].email).toBe("admin@crm.local");
    });
  });

  describe("CRM DASHBOARD", () => {
    test("GET /api/dashboard/stats returns CRM stats", async () => {
      const token = await loginAsAdmin();
      const lead = await Lead.create({
        name: "Client Lead",
        phone: "+50934111111",
        status: "client",
        score: 80
      });
      await Message.create({
        lead_id: lead.id,
        message: "hello",
        type: "initial",
        status: "sent"
      });
      await FollowUp.create({
        lead_id: lead.id,
        scheduled_date: new Date(),
        message: "follow up",
        status: "pending"
      });

      const response = await request(app).get("/api/dashboard/stats").set(auth(token));

      expect(response.status).toBe(200);
      expectJson(response);
      expect(response.body.total_leads).toBe(1);
      expect(response.body.total_clients).toBe(1);
      expect(response.body.hot_leads).toBe(1);
      expect(response.body.messages_sent).toBe(1);
      expect(response.body.followups_pending).toBe(1);
      expect(Array.isArray(response.body.leads_by_tag)).toBe(true);
    });
  });

  describe("ACTIVATION STUDENTS", () => {
    test("POST /api/activation/students creates a student", async () => {
      const token = await loginAsAdmin();

      const response = await request(app).post("/api/activation/students").set(auth(token)).send({
        name: "Jean Pierre",
        phone: "+50934123456",
        status: "paid_training"
      });

      expect(response.status).toBe(201);
      expectJson(response);
      expect(response.body.id).toBeDefined();
      expect(response.body.name).toBe("Jean Pierre");
      expect(response.body.status).toBe("paid_training");
    });

    test("GET /api/activation/students returns students and supports status filter", async () => {
      const token = await loginAsAdmin();
      await Student.bulkCreate([
        { name: "S1", phone: "+50934000111", status: "onboarding", created_at: new Date() },
        { name: "S2", phone: "+50934000112", status: "active", created_at: new Date() }
      ]);

      const response = await request(app)
        .get("/api/activation/students")
        .query({ status: "onboarding" })
        .set(auth(token));

      expect(response.status).toBe(200);
      expectJson(response);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].status).toBe("onboarding");
    });

    test("GET /api/activation/students returns pagination metadata when requested", async () => {
      const token = await loginAsAdmin();
      await Student.bulkCreate([
        { name: "Page One", phone: "+50931000001" },
        { name: "Page Two", phone: "+50931000002" }
      ]);

      const response = await request(app)
        .get("/api/activation/students?page=1&limit=1")
        .set(auth(token));

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.pagination).toMatchObject({
        page: 1,
        limit: 1,
        total: 2,
        total_pages: 2,
        has_next: true
      });
    });

    test("GET /api/activation/dashboard/summary returns activation summary", async () => {
      const token = await loginAsAdmin();
      const oldDate = new Date(Date.now() - 26 * 60 * 60 * 1000);
      await Student.bulkCreate([
        {
          name: "Paid",
          phone: "+50934000611",
          status: "paid_training",
          created_at: new Date(),
          last_action_at: new Date()
        },
        {
          name: "Blocked",
          phone: "+50934000616",
          status: "blocked",
          created_at: new Date(),
          last_action_at: new Date()
        },
        {
          name: "At Risk Candidate",
          phone: "+50934000617",
          status: "onboarding",
          created_at: oldDate,
          last_action_at: oldDate
        }
      ]);

      const response = await request(app).get("/api/activation/dashboard/summary").set(auth(token));

      expect(response.status).toBe(200);
      expectJson(response);
      expect(response.body.paid_training).toBe(1);
      expect(response.body.blocked).toBe(1);
      expect(Array.isArray(response.body.at_risk_students)).toBe(true);
      expect(
        response.body.at_risk_students.some((student) => student.name === "At Risk Candidate")
      ).toBe(true);
    });
  });

  describe("SUPPORT TASKS", () => {
    test("POST /api/activation/tasks creates one unresolved task per type per student", async () => {
      const token = await loginAsAdmin();
      const student = await Student.create({
        name: "Support Student",
        phone: "+50934001001",
        status: "onboarding"
      });

      const payload = {
        student_id: student.id,
        type: "onboarding_issue",
        priority: "urgent",
        notes: "Needs onboarding support"
      };

      const first = await request(app).post("/api/activation/tasks").set(auth(token)).send(payload);
      const duplicate = await request(app)
        .post("/api/activation/tasks")
        .set(auth(token))
        .send(payload);

      expect(first.status).toBe(201);
      expectJson(first);
      expect(first.body.id).toBeDefined();
      expect(first.body.type).toBe("onboarding_issue");
      expect(first.body.status).toBe("pending");

      expect(duplicate.status).toBe(200);
      expect(duplicate.body.id).toBe(first.body.id);
      expect(await Task.count()).toBe(1);
    });

    test("GET /api/activation/tasks returns open tasks", async () => {
      const token = await loginAsAdmin();
      const student = await Student.create({
        name: "Open Task Student",
        phone: "+50934001002",
        status: "at_risk"
      });
      await Task.create({
        student_id: student.id,
        type: "motivation_issue",
        status: "pending",
        priority: "urgent"
      });
      await Task.create({
        student_id: student.id,
        type: "technical_issue",
        status: "resolved",
        priority: "normal",
        resolved_at: new Date()
      });

      const response = await request(app).get("/api/activation/tasks").set(auth(token));

      expect(response.status).toBe(200);
      expectJson(response);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].type).toBe("motivation_issue");
    });

    test("PATCH task assign and resolve update task, log StudentAction, and touch student", async () => {
      const token = await loginAsAdmin();
      const admin = await User.findOne({ where: { email: "admin@crm.local" } });
      const student = await Student.create({
        name: "Resolve Task Student",
        phone: "+50934001003",
        status: "blocked",
        last_action_at: null
      });
      const task = await Task.create({
        student_id: student.id,
        type: "technical_issue",
        status: "pending",
        priority: "urgent"
      });

      const assigned = await request(app)
        .patch(`/api/activation/tasks/${task.id}/assign`)
        .set(auth(token))
        .send({ assigned_to: admin.id, notes: "Taking ownership" });

      expect(assigned.status).toBe(200);
      expectJson(assigned);
      expect(assigned.body.assigned_to).toBe(admin.id);
      expect(assigned.body.status).toBe("in_progress");

      const resolved = await request(app)
        .patch(`/api/activation/tasks/${task.id}/resolve`)
        .set(auth(token))
        .send({ notes: "Resolved by support" });

      expect(resolved.status).toBe(200);
      expectJson(resolved);
      expect(resolved.body.status).toBe("resolved");
      expect(resolved.body.resolved_at).toBeDefined();

      const actionCount = await StudentAction.count({
        where: { student_id: student.id, type: "support" }
      });
      expect(actionCount).toBe(2);

      await student.reload();
      expect(student.last_action_at).toBeTruthy();
    });

    test("activation automation creates support tasks for abandonment risks", async () => {
      const token = await loginAsAdmin();
      const oldDate = new Date(Date.now() - 50 * 60 * 60 * 1000);
      const atRisk = await Student.create({
        name: "At Risk",
        phone: "+50934001004",
        status: "at_risk",
        created_at: oldDate,
        last_action_at: oldDate
      });
      const blocked = await Student.create({
        name: "Blocked",
        phone: "+50934001005",
        status: "blocked",
        created_at: oldDate,
        last_action_at: oldDate
      });
      const staleOnboarding = await Student.create({
        name: "Stale Onboarding",
        phone: "+50934001006",
        status: "onboarding",
        created_at: oldDate,
        last_action_at: oldDate
      });

      const recovery = await request(app)
        .post(`/api/activation/students/${atRisk.id}/recovery`)
        .set(auth(token))
        .send();
      expect(recovery.status).toBe(200);

      const check = await request(app)
        .post("/api/activation/at-risk/check")
        .set(auth(token))
        .send();
      expect(check.status).toBe(200);

      const taskRows = await Task.findAll({
        order: [
          ["student_id", "ASC"],
          ["type", "ASC"]
        ],
        raw: true
      });
      const byStudent = taskRows.reduce((acc, row) => {
        acc[row.student_id] = acc[row.student_id] || [];
        acc[row.student_id].push(row.type);
        return acc;
      }, {});

      expect(byStudent[atRisk.id]).toContain("motivation_issue");
      expect(byStudent[blocked.id]).toContain("technical_issue");
      expect(byStudent[staleOnboarding.id]).toContain("onboarding_issue");
      expect(byStudent[staleOnboarding.id]).toContain("technical_issue");
    });
  });

  describe("TRACKING", () => {
    test("GET /t/:token logs a tracking event and redirects", async () => {
      const student = await Student.create({
        name: "Tracked Student",
        phone: "+50934000999",
        status: "onboarding"
      });
      const token = trackingService.generateTrackingLink(student.id, "activation").split("/t/")[1];

      const response = await request(app).get(`/t/${token}`);

      expect(response.status).toBe(302);
      expect(response.headers.location).toBeDefined();
      const eventCount = await TrackingEvent.count({
        where: { student_id: student.id, event_type: "click" }
      });
      expect(eventCount).toBe(1);
    });

    test("tracking tokens expire and reject a modified signature", () => {
      process.env.TRACKING_TOKEN_TTL_SECONDS = "60";
      const now = Date.now();
      const nowSpy = jest.spyOn(Date, "now").mockReturnValue(now);
      const token = trackingService.generateTrackingLink(1, "activation").split("/t/")[1];

      expect(() => trackingService.decodeToken(`${token}x`)).toThrow("Invalid tracking signature");
      nowSpy.mockReturnValue(now + 61_000);
      expect(() => trackingService.decodeToken(token)).toThrow("Tracking token expired");
      nowSpy.mockRestore();
      delete process.env.TRACKING_TOKEN_TTL_SECONDS;
    });
  });

  describe("WHATSAPP OUTBOUND HISTORY", () => {
    beforeEach(() => {
      process.env.WHATSAPP_SEND_ENABLED = "true";
    });

    afterEach(() => {
      delete process.env.WHATSAPP_SEND_ENABLED;
    });

    test("records explicit Lead consent and Meta acceptance for the initial message", async () => {
      const token = await loginAsAdmin();
      const response = await request(app).post("/api/leads").set(auth(token)).send({
        name: "Initial History",
        phone: "+509 37 00 02 01",
        whatsapp_opt_in: true,
        whatsapp_opt_in_source: "authenticated_crm_form"
      });

      expect(response.status).toBe(201);
      const delivery = await Message.findOne({
        where: { lead_id: response.body.id, type: "initial" }
      });
      expect(delivery).toMatchObject({
        status: "accepted",
        meta_status: "accepted",
        delivery_evidence: "meta_accepted"
      });
      expect(delivery.meta_message_id).toMatch(/^wamid\.test\./);
      expect(
        await WhatsAppConsentEvent.count({
          where: { contact_type: "lead", contact_id: response.body.id, action: "opt_in" }
        })
      ).toBe(1);
    });

    test("records explicit Student consent and Meta acceptance for recovery", async () => {
      const token = await loginAsAdmin();
      const created = await request(app).post("/api/activation/students").set(auth(token)).send({
        name: "Recovery History",
        phone: "+509 37 00 02 02",
        status: "at_risk",
        whatsapp_opt_in: true,
        whatsapp_opt_in_source: "authenticated_crm_form"
      });
      expect(created.status).toBe(201);

      const recovery = await request(app)
        .post(`/api/activation/students/${created.body.id}/recovery`)
        .set(auth(token))
        .send();
      expect(recovery.status).toBe(200);
      expect(recovery.body.status).toBe("accepted");

      const delivery = await Message.findOne({
        where: { student_id: created.body.id, type: "recovery" }
      });
      expect(delivery).toMatchObject({
        status: "accepted",
        meta_status: "accepted",
        delivery_evidence: "meta_accepted"
      });
      expect(delivery.meta_message_id).toMatch(/^wamid\.test\./);
      expect(
        await WhatsAppConsentEvent.count({
          where: { contact_type: "student", contact_id: created.body.id, action: "opt_in" }
        })
      ).toBe(1);
    });

    test("rejects an opt-in without a consent source", async () => {
      const token = await loginAsAdmin();
      const [lead, student] = await Promise.all([
        request(app).post("/api/leads").set(auth(token)).send({
          name: "Missing Lead Evidence",
          phone: "+509 37 00 02 03",
          whatsapp_opt_in: true
        }),
        request(app).post("/api/activation/students").set(auth(token)).send({
          name: "Missing Student Evidence",
          phone: "+509 37 00 02 04",
          whatsapp_opt_in: true
        })
      ]);

      expect(lead.status).toBe(400);
      expect(student.status).toBe(400);
    });
  });

  describe("FOLLOW-UP DELIVERY", () => {
    beforeEach(() => {
      process.env.WHATSAPP_SEND_ENABLED = "true";
    });

    afterEach(() => {
      delete process.env.WHATSAPP_SEND_ENABLED;
    });

    test("leaves pending follow-ups untouched while the master switch is disabled", async () => {
      delete process.env.WHATSAPP_SEND_ENABLED;
      const lead = await Lead.create({
        name: "Switch Disabled",
        phone: "+50934000001",
        whatsapp_opt_in: true,
        whatsapp_opt_in_at: new Date()
      });
      const followUp = await FollowUp.create({
        lead_id: lead.id,
        scheduled_date: new Date(Date.now() - 1000),
        message: "Wait for activation",
        status: "pending"
      });

      const result = await processPendingFollowups();

      await followUp.reload();
      expect(result.disabled).toBe(true);
      expect(followUp.status).toBe("pending");
      expect(followUp.attempt_count).toBe(0);
    });

    test("concurrent processors claim and submit a follow-up to Meta only once", async () => {
      const lead = await Lead.create({
        name: "One Delivery",
        phone: "+50934000123",
        whatsapp_opt_in: true,
        whatsapp_opt_in_at: new Date()
      });
      const followUp = await FollowUp.create({
        lead_id: lead.id,
        scheduled_date: new Date(Date.now() - 1000),
        message: "Only once",
        status: "pending"
      });

      await Promise.all([processPendingFollowups(), processPendingFollowups()]);

      await followUp.reload();
      expect(followUp.status).toBe("processing");
      expect(followUp.attempt_count).toBe(1);
      expect(followUp.meta_status).toBe("accepted");
      expect(followUp.accepted_at).toBeTruthy();
      expect(followUp.sent_at).toBeNull();
      expect(followUp.provider_message_id).toMatch(/^wamid\.test\./);
      expect(await Message.count({ where: { followup_id: followUp.id } })).toBe(1);
      const message = await Message.findOne({ where: { followup_id: followUp.id } });
      expect(message.status).toBe("accepted");
      expect(message.meta_message_id).toBe(followUp.provider_message_id);
    });

    test("sends a provider-accepted delivery to review when local finalization fails", async () => {
      const lead = await Lead.create({
        name: "Reconcile Me",
        phone: "+50934000456",
        whatsapp_opt_in: true,
        whatsapp_opt_in_at: new Date()
      });
      const followUp = await FollowUp.create({
        lead_id: lead.id,
        scheduled_date: new Date(Date.now() - 1000),
        message: "Accepted remotely",
        status: "pending"
      });
      const originalFindOrCreate = Message.findOrCreate.bind(Message);
      const finalizeSpy = jest
        .spyOn(Message, "findOrCreate")
        .mockRejectedValueOnce(new Error("local database finalization failed"))
        .mockImplementation(originalFindOrCreate);

      await processPendingFollowups();

      finalizeSpy.mockRestore();
      await followUp.reload();
      expect(followUp.status).toBe("needs_review");
      expect(followUp.provider_message_id).toMatch(/^wamid\.test\./);
      expect(followUp.review_reason).toContain("local finalization failed");
      expect(followUp.last_error).toContain("local database finalization failed");
    });

    test("cancels a due follow-up when the lead has no WhatsApp opt-in", async () => {
      const lead = await Lead.create({ name: "No Consent", phone: "+50934000789" });
      const followUp = await FollowUp.create({
        lead_id: lead.id,
        scheduled_date: new Date(Date.now() - 1000),
        message: "Must not be sent",
        status: "pending"
      });

      const result = await processPendingFollowups();

      await followUp.reload();
      expect(result.accepted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(followUp.status).toBe("needs_review");
      expect(followUp.cancelled).toBe(true);
      expect(followUp.review_reason).toBe("skipped_opt_out");
      expect(followUp.last_error).toContain("Explicit WhatsApp opt-in");
      expect(await Message.count({ where: { followup_id: followUp.id } })).toBe(0);
    });

    test("never marks a client follow-up completed without delivery proof", async () => {
      const lead = await Lead.create({
        name: "Already Client",
        phone: "+50937000205",
        status: "client",
        whatsapp_opt_in: true,
        whatsapp_opt_in_at: new Date()
      });
      const followUp = await FollowUp.create({
        lead_id: lead.id,
        scheduled_date: new Date(Date.now() - 1000),
        message: "No premature completion",
        status: "pending"
      });

      await processPendingFollowups();

      await followUp.reload();
      expect(followUp.status).toBe("pending");
      expect(followUp.cancelled).toBe(true);
      expect(followUp.review_reason).toBe("lead_is_client");
      expect(followUp.delivered_at).toBeNull();
      expect(await Message.count({ where: { followup_id: followUp.id } })).toBe(0);
    });
  });

  describe("CONTACT GROUPS", () => {
    beforeEach(() => {
      process.env.WHATSAPP_SEND_ENABLED = "true";
    });

    afterEach(() => {
      delete process.env.WHATSAPP_SEND_ENABLED;
    });

    test("POST /api/groups creates a group", async () => {
      const token = await loginAsAdmin();

      const response = await request(app).post("/api/groups").set(auth(token)).send({
        name: "Clients formation",
        description: "Contacts formation",
        category: "formation"
      });

      expect(response.status).toBe(201);
      expectJson(response);
      expect(response.body.name).toBe("Clients formation");
      expect(response.body.description).toBe("Contacts formation");
      expect(response.body.category).toBe("formation");
      expect(response.body.is_active).toBe(true);
    });

    test("POST /api/groups/:id/members adds a member and prevents duplicates", async () => {
      const token = await loginAsAdmin();
      const group = await request(app)
        .post("/api/groups")
        .set(auth(token))
        .send({ name: "Prospects interesses" });
      const lead = await Lead.create({
        name: "Group Lead",
        phone: "+50955000001",
        status: "new"
      });

      const first = await request(app)
        .post(`/api/groups/${group.body.id}/members`)
        .set(auth(token))
        .send({
          contact_type: "lead",
          contact_id: lead.id,
          problem_reason: "interested",
          notes: "manual add"
        });
      const duplicate = await request(app)
        .post(`/api/groups/${group.body.id}/members`)
        .set(auth(token))
        .send({ contact_type: "lead", contact_id: lead.id });

      expect(first.status).toBe(201);
      expect(first.body.problem_reason).toBe("interested");
      expect(first.body.notes).toBe("manual add");
      expect(duplicate.status).toBe(200);
      const count = await ContactGroupMember.count({
        where: { group_id: group.body.id, contact_type: "lead", contact_id: lead.id }
      });
      expect(count).toBe(1);
    });

    test("POST /api/groups/:id/import-csv creates and reuses leads while adding valid contacts to group", async () => {
      const token = await loginAsAdmin();
      const group = await request(app)
        .post("/api/groups")
        .set(auth(token))
        .send({ name: "Import CSV" });
      await Lead.create({
        name: "Existing CSV",
        phone: "+50955000009",
        email: "old@example.com",
        status: "new"
      });

      const response = await request(app)
        .post(`/api/groups/${group.body.id}/import-csv`)
        .set(auth(token))
        .send({
          csv: "name,phone,email,problem_reason,notes\nCSV One,+50955000002,one@example.com,non paye,first\nExisting CSV,+50955000009,new@example.com,deja la,second\nCSV Bad,,bad@example.com,missing phone,bad\nCSV One,+50955000002,one@example.com,duplicate,dup"
        });

      expect(response.status).toBe(200);
      expectJson(response);
      expect(response.body.created).toBe(1);
      expect(response.body.existing).toBe(2);
      expect(response.body.invalid).toBe(1);
      expect(response.body.added_to_group).toBe(2);
      expect(response.body.duplicates_ignored).toBe(1);
      expect(response.body.total_rows).toBe(4);

      const members = await request(app)
        .get(`/api/groups/${group.body.id}/members`)
        .set(auth(token));
      expect(members.status).toBe(200);
      expect(members.body).toHaveLength(2);
      expect(members.body.some((member) => member.problem_reason === "non paye")).toBe(true);
      expect(await Lead.count()).toBe(2);
    });

    test("PATCH and DELETE group member update metadata and remove membership only", async () => {
      const token = await loginAsAdmin();
      const group = await request(app)
        .post("/api/groups")
        .set(auth(token))
        .send({ name: "Patch Members" });
      const lead = await Lead.create({ name: "Patch Lead", phone: "+50955000010", status: "new" });
      const member = await request(app)
        .post(`/api/groups/${group.body.id}/members`)
        .set(auth(token))
        .send({ contact_type: "lead", contact_id: lead.id });

      const patched = await request(app)
        .patch(`/api/groups/${group.body.id}/members/${member.body.id}`)
        .set(auth(token))
        .send({ problem_reason: "client non paye", notes: "relancer vendredi" });
      expect(patched.status).toBe(200);
      expect(patched.body.problem_reason).toBe("client non paye");
      expect(patched.body.notes).toBe("relancer vendredi");

      const removed = await request(app)
        .delete(`/api/groups/${group.body.id}/members/${member.body.id}`)
        .set(auth(token));
      expect(removed.status).toBe(200);
      expect(await ContactGroupMember.count({ where: { group_id: group.body.id } })).toBe(0);
      expect(await Lead.findByPk(lead.id)).toBeTruthy();
    });

    test("POST /api/groups/:id/send-message dry_run renders recipients", async () => {
      const token = await loginAsAdmin();
      const group = await request(app)
        .post("/api/groups")
        .set(auth(token))
        .send({ name: "Coaching prive" });
      const lead = await Lead.create({
        name: "Dry Run Lead",
        phone: "+50955000003",
        status: "new"
      });
      await request(app)
        .post(`/api/groups/${group.body.id}/members`)
        .set(auth(token))
        .send({ contact_type: "lead", contact_id: lead.id });

      const response = await request(app)
        .post(`/api/groups/${group.body.id}/send-message`)
        .set(auth(token))
        .send({ dry_run: true, message_template: "Bonjour {{name}} du groupe {{groupName}}" });

      expect(response.status).toBe(200);
      expectJson(response);
      expect(response.body.dry_run).toBe(true);
      expect(response.body.preview_token).toBeDefined();
      expect(response.body.recipients[0].message).toContain("Dry Run Lead");
      expect(response.body.recipients[0].message).toContain("Coaching prive");
    });

    test("POST /api/groups/:id/send-message requires dry_run before real send", async () => {
      const token = await loginAsAdmin();
      const group = await request(app)
        .post("/api/groups")
        .set(auth(token))
        .send({ name: "No direct send" });
      const lead = await Lead.create({
        name: "No Direct Lead",
        phone: "+50955000004",
        status: "new"
      });
      await request(app)
        .post(`/api/groups/${group.body.id}/members`)
        .set(auth(token))
        .send({ contact_type: "lead", contact_id: lead.id });

      const response = await request(app)
        .post(`/api/groups/${group.body.id}/send-message`)
        .set(auth(token))
        .send({ dry_run: false, message_template: "Bonjour {{name}}" });

      expect(response.status).toBe(409);
      expect(response.body.message).toMatch(/dry_run/);
    });

    test("POST /api/groups/:id/send-message sends after dry_run with test mock", async () => {
      const token = await loginAsAdmin();
      const group = await request(app)
        .post("/api/groups")
        .set(auth(token))
        .send({ name: "Send Group" });
      const consentAt = new Date();
      const lead = await Lead.create({
        name: "Send Lead",
        phone: "+50955000005",
        status: "new",
        whatsapp_opt_in: true,
        whatsapp_opt_in_at: consentAt
      });
      const student = await Student.create({
        name: "Send Student",
        phone: "+50955000006",
        status: "at_risk",
        whatsapp_opt_in: true,
        whatsapp_opt_in_at: consentAt
      });
      await request(app)
        .post(`/api/groups/${group.body.id}/members`)
        .set(auth(token))
        .send({ contact_type: "lead", contact_id: lead.id });
      await request(app)
        .post(`/api/groups/${group.body.id}/members`)
        .set(auth(token))
        .send({ contact_type: "student", contact_id: student.id });

      const preview = await request(app)
        .post(`/api/groups/${group.body.id}/send-message`)
        .set(auth(token))
        .send({ dry_run: true, message_template: "Bonjour {{name}}" });
      const response = await request(app)
        .post(`/api/groups/${group.body.id}/send-message`)
        .set(auth(token))
        .send({
          dry_run: false,
          preview_token: preview.body.preview_token,
          message_template: "Bonjour {{name}}"
        });

      expect(response.status).toBe(200);
      expect(response.body.accepted).toBe(2);
      expect(await Message.count({ where: { lead_id: lead.id } })).toBe(1);
      expect(await Message.count({ where: { student_id: student.id, type: "group" } })).toBe(1);
      expect(
        await StudentAction.count({ where: { student_id: student.id, type: "message" } })
      ).toBe(1);
    });

    test("GET /api/groups requires JWT", async () => {
      const response = await request(app).get("/api/groups");

      expect(response.status).toBe(401);
      expectJson(response);
    });
  });

  describe("REMOVED ROUTE MISMATCHES", () => {
    test("GET /api/students is not exposed by the root backend", async () => {
      const token = await loginAsAdmin();

      const response = await request(app).get("/api/students").set(auth(token));

      expect(response.status).toBe(404);
    });
  });
});
