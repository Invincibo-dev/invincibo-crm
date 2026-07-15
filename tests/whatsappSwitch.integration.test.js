const https = require("https");
const jwt = require("jsonwebtoken");
const request = require("supertest");

process.env.WHATSAPP_SEND_ENABLED = "false";
process.env.FOLLOWUP_CRON_ENABLED = "false";
process.env.JWT_SECRET = "switch_test_fictitious_jwt_secret";
process.env.API_RATE_LIMIT_MAX = "100000";

jest.mock("axios", () => jest.fn(() => Promise.reject(new Error("NETWORK_CALL_FORBIDDEN"))));
jest.mock("../services/googleService", () => ({
  addContactToGoogle: jest.fn(() => Promise.resolve())
}));

const axios = require("axios");
const app = require("../app");
const runtimeState = require("../config/runtimeState");
const {
  ContactGroupMember,
  FollowUp,
  Lead,
  Message,
  Student,
  User,
  WhatsAppConsentEvent,
  sequelize
} = require("../models");
const groupService = require("../services/groupService");
const automationService = require("../services/activation/automationService");
const { processPendingFollowups } = require("../services/whatsappService");

describe("WhatsApp global outbound switch", () => {
  let admin;
  let auth;
  let httpsSpy;

  beforeAll(async () => {
    await sequelize.sync({ force: true });
    runtimeState.markReady();
    admin = await User.create({
      name: "Switch Test Admin",
      email: "switch-test@example.test",
      password_hash: "not-used",
      role: "admin"
    });
    auth = {
      Authorization: `Bearer ${jwt.sign(
        { id: admin.id, email: admin.email, role: admin.role },
        process.env.JWT_SECRET
      )}`
    };
  });

  beforeEach(() => {
    process.env.WHATSAPP_SEND_ENABLED = "false";
    process.env.FOLLOWUP_CRON_ENABLED = "false";
    jest.clearAllMocks();
    httpsSpy = jest.spyOn(https, "request").mockImplementation(() => {
      throw new Error("NETWORK_CALL_FORBIDDEN");
    });
  });

  afterEach(() => {
    httpsSpy.mockRestore();
  });

  afterAll(async () => {
    runtimeState.markNotReady();
    await sequelize.close();
  });

  test("blocks initial, follow-up, group, activation and cron network paths", async () => {
    const leadResponse = await request(app).post("/api/leads").set(auth).send({
      name: "Switch Lead",
      phone: "+509 37 00 01 01",
      whatsapp_opt_in: true,
      whatsapp_opt_in_source: "authenticated_test_form"
    });
    expect(leadResponse.status).toBe(201);
    const lead = await Lead.findByPk(leadResponse.body.id);
    expect(await Message.count({ where: { lead_id: lead.id } })).toBe(0);
    expect(
      await WhatsAppConsentEvent.count({
        where: { contact_type: "lead", contact_id: lead.id, action: "opt_in" }
      })
    ).toBe(1);

    await FollowUp.create({
      lead_id: lead.id,
      scheduled_date: new Date(Date.now() - 1000),
      message: "Switch follow-up",
      status: "pending"
    });
    const followupResult = await processPendingFollowups();
    expect(followupResult.disabled).toBe(true);

    const group = await groupService.createGroup({
      name: "Switch Group",
      createdBy: admin.id
    });
    await groupService.addMember({
      groupId: group.id,
      contactType: "lead",
      contactId: lead.id
    });
    expect(await ContactGroupMember.count({ where: { group_id: group.id } })).toBe(1);
    const preview = await groupService.sendMessage({
      groupId: group.id,
      messageTemplate: "Bonjour {{name}}",
      dryRun: true,
      userId: admin.id
    });
    const groupResult = await groupService.sendMessage({
      groupId: group.id,
      messageTemplate: "Bonjour {{name}}",
      dryRun: false,
      userId: admin.id,
      token: preview.preview_token
    });
    expect(groupResult.disabled).toBe(true);

    const studentResponse = await request(app).post("/api/activation/students").set(auth).send({
      name: "Switch Student",
      phone: "+509 37 00 01 02",
      status: "at_risk",
      whatsapp_opt_in: true,
      whatsapp_opt_in_source: "authenticated_test_form"
    });
    expect(studentResponse.status).toBe(201);
    const student = await Student.findByPk(studentResponse.body.id);
    expect(
      await WhatsAppConsentEvent.count({
        where: { contact_type: "student", contact_id: student.id, action: "opt_in" }
      })
    ).toBe(1);
    const recovery = await automationService.triggerStudentRecovery({ id: student.id });
    expect(recovery.status).toBe("sending_disabled");

    expect(process.env.FOLLOWUP_CRON_ENABLED).toBe("false");
    expect(axios).not.toHaveBeenCalled();
    expect(httpsSpy).not.toHaveBeenCalled();
  });
});
