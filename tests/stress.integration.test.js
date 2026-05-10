const request = require("supertest");
const bcrypt = require("bcryptjs");

process.env.API_RATE_LIMIT_MAX = "100000";
process.env.LOGIN_RATE_LIMIT_MAX = "100000";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret";

const app = require("../app");
const { sequelize, Student, StudentAction, User } = require("../models");
const activationService = require("../services/activation/activationService");

jest.setTimeout(300000);

const metrics = {};
const scenarioReports = [];
const DAY_MS = 24 * 60 * 60 * 1000;

const nowMs = () => Number(process.hrtime.bigint() / 1000000n);
const startMetric = () => nowMs();

const endMetric = (name, startedAt, success = true) => {
  const elapsedMs = nowMs() - startedAt;
  if (!metrics[name]) {
    metrics[name] = { count: 0, totalMs: 0, maxMs: 0, failures: 0 };
  }

  metrics[name].count += 1;
  metrics[name].totalMs += elapsedMs;
  metrics[name].maxMs = Math.max(metrics[name].maxMs, elapsedMs);
  if (!success) {
    metrics[name].failures += 1;
  }

  return elapsedMs;
};

const withMetric = async (name, fn) => {
  const startedAt = startMetric();
  try {
    const result = await fn();
    const elapsedMs = endMetric(name, startedAt, true);
    return { result, elapsedMs };
  } catch (error) {
    endMetric(name, startedAt, false);
    throw error;
  }
};

const runInBatches = async (items, worker, batchSize = 10) => {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((item, idx) => worker(item, i + idx)));
    results.push(...batchResults);
  }
  return results;
};

const makeRng = (seed = 123456) => {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const seeded = makeRng(20260422);
const pick = (arr) => arr[Math.floor(seeded() * arr.length)];
const randomStatus = () => pick(["paid_training", "onboarding", "step1", "active", "inactive", "blocked"]);

const createStudentPayload = (index, prefix = "stress") => ({
  name: `${prefix}-student-${index}`,
  phone: `+509${String(34000000 + index).padStart(8, "0")}`,
  status: randomStatus()
});

let authToken;

const authHeaders = () => ({ Authorization: `Bearer ${authToken}` });

const resetDatabase = async () => {
  await sequelize.sync({ force: true });
  await User.create({
    name: "Stress Admin",
    email: "stress-admin@crm.local",
    password_hash: await bcrypt.hash("StrongPass123", 10),
    role: "admin"
  });

  const response = await request(app).post("/api/auth/login").send({
    email: "stress-admin@crm.local",
    password: "StrongPass123"
  });

  if (response.status !== 200 || !response.body.token) {
    throw new Error(`Unable to authenticate stress admin: ${response.status}`);
  }

  authToken = response.body.token;
};

const summarizeMetrics = () => {
  const rows = Object.entries(metrics).map(([name, row]) => ({
    name,
    count: row.count,
    avgMs: row.count ? Number((row.totalMs / row.count).toFixed(2)) : 0,
    maxMs: row.maxMs,
    failures: row.failures
  }));

  rows.sort((a, b) => b.avgMs - a.avgMs);

  const slowest = rows[0] || null;
  const failedOps = rows.reduce((sum, row) => sum + row.failures, 0);

  return { rows, slowest, failedOps };
};

describe("Activation Engine stress/load suite", () => {
  beforeAll(async () => {
    await sequelize.authenticate();
    await resetDatabase();
  });

  afterAll(async () => {
    const summary = summarizeMetrics();

    console.log("\n=== STRESS TEST PERFORMANCE SUMMARY ===");
    summary.rows.forEach((row) => {
      console.log(
        `${row.name}: count=${row.count}, avgMs=${row.avgMs}, maxMs=${row.maxMs}, failures=${row.failures}`
      );
    });

    if (summary.slowest) {
      console.log(
        `Slowest operation by average: ${summary.slowest.name} (avg ${summary.slowest.avgMs} ms, max ${summary.slowest.maxMs} ms)`
      );
    }

    console.log(`Failed operations: ${summary.failedOps}`);
    console.log("=== END SUMMARY ===\n");

    await sequelize.close();
  });

  test("1) BULK STUDENT CREATION STRESS (100, 250, 500)", async () => {
    await resetDatabase();

    const sizes = [100, 250, 500];

    for (const size of sizes) {
      const started = startMetric();

      for (let i = 0; i < size; i += 1) {
        const payload = createStudentPayload(i + size * 10, `bulk-${size}`);
        const { result: response } = await withMetric("POST /api/activation/students", () =>
          request(app).post("/api/activation/students").set(authHeaders()).send(payload)
        );

        expect(response.status).toBe(201);
        expect(response.headers["content-type"]).toMatch(/application\/json/);
        expect(response.body.id).toBeDefined();
        expect(response.body.name).toBe(payload.name);
        expect(response.body.status).toBeDefined();
      }

      const elapsed = endMetric(`SCENARIO1_BULK_${size}`, started, true);
      scenarioReports.push({ scenario: `bulk-${size}`, elapsedMs: elapsed });
      console.log(`Scenario bulk-${size}: ${elapsed}ms for ${size} students`);
    }
  });

  test("2) CONCURRENT ACTION LOGGING (50 students x 5 actions)", async () => {
    await resetDatabase();

    const students = [];
    for (let i = 0; i < 50; i += 1) {
      const payload = createStudentPayload(i + 20000, "actions");
      const { result: response } = await withMetric("POST /api/activation/students", () =>
        request(app).post("/api/activation/students").set(authHeaders()).send(payload)
      );
      students.push(response.body);
    }

    const jobs = [];
    const actionTypes = ["onboarding", "step1", "support", "message", "activation"];
    students.forEach((student, idx) => {
      for (let j = 0; j < 5; j += 1) {
        jobs.push({ studentId: student.id, type: actionTypes[(idx + j) % actionTypes.length], idx, j });
      }
    });

    const started = startMetric();
    const results = await runInBatches(
      jobs,
      async (job) =>
        withMetric("POST /api/activation/students/:id/actions", () =>
          request(app)
            .post(`/api/activation/students/${job.studentId}/actions`)
            .set(authHeaders())
            .send({ type: job.type, content: `stress action ${job.idx}-${job.j}` })
        ),
      10
    );

    const elapsed = endMetric("SCENARIO2_CONCURRENT_ACTIONS", started, true);
    scenarioReports.push({ scenario: "concurrent-actions", elapsedMs: elapsed });

    results.forEach(({ result: response }) => {
      expect(response.status).toBe(201);
      expect(response.headers["content-type"]).toMatch(/application\/json/);
      expect(response.body.id).toBeDefined();
      expect(response.body.student_id).toBeDefined();
    });

    const totalActions = await StudentAction.count();
    expect(totalActions).toBeGreaterThanOrEqual(50 * 5 + 50);
    console.log(`Scenario concurrent-actions: ${elapsed}ms for ${results.length} action requests`);
  });

  test("3) STATUS UPDATE STRESS (100 students concurrent transitions)", async () => {
    await resetDatabase();

    const createdIds = [];
    for (let i = 0; i < 100; i += 1) {
      const { result: response } = await withMetric("POST /api/activation/students", () =>
        request(app)
          .post("/api/activation/students")
          .set(authHeaders())
          .send({ name: `status-student-${i}`, phone: `+50935${String(100000 + i).slice(-6)}`, status: "paid_training" })
      );
      createdIds.push(response.body.id);
    }

    const transitionFlow = ["onboarding_start", "step1_complete", "server_activated"];
    const started = startMetric();

    await runInBatches(
      createdIds,
      async (id) => {
        for (const actionType of transitionFlow) {
          const { result: response } = await withMetric("PATCH /api/activation/students/:id/status", () =>
            request(app).patch(`/api/activation/students/${id}/status`).set(authHeaders()).send({ status: actionType })
          );
          expect(response.status).toBe(200);
          expect(response.headers["content-type"]).toMatch(/application\/json/);
          expect(response.body.id).toBe(id);
          expect(response.body.status).toBeDefined();
        }
      },
      10
    );

    const elapsed = endMetric("SCENARIO3_STATUS_STRESS", started, true);
    scenarioReports.push({ scenario: "status-stress", elapsedMs: elapsed });

    const activeCount = await Student.count({ where: { status: "active" } });
    expect(activeCount).toBe(100);
    console.log(`Scenario status-stress: ${elapsed}ms for ${100 * 3} status updates`);
  });

  test("4) AT-RISK BATCH PROCESS STRESS (200 seeded students)", async () => {
    await resetDatabase();

    const old24h = new Date(Date.now() - 26 * 60 * 60 * 1000);
    const old48h = new Date(Date.now() - 50 * 60 * 60 * 1000);

    const seedRows = [];
    for (let i = 0; i < 120; i += 1) {
      seedRows.push({
        name: `risk-${i}`,
        phone: `+50936${String(100000 + i).slice(-6)}`,
        status: "step1",
        created_at: old24h,
        last_action_at: old24h
      });
    }
    for (let i = 0; i < 80; i += 1) {
      seedRows.push({
        name: `blocked-candidate-${i}`,
        phone: `+50937${String(100000 + i).slice(-6)}`,
        status: "onboarding",
        created_at: old48h,
        last_action_at: old48h
      });
    }

    await Student.bulkCreate(seedRows);

    const started = startMetric();
    const { result: atRiskStudents } = await withMetric("SERVICE checkAtRiskStudents", () =>
      activationService.checkAtRiskStudents()
    );

    const elapsed = endMetric("SCENARIO4_AT_RISK_BATCH", started, true);
    scenarioReports.push({ scenario: "at-risk-batch", elapsedMs: elapsed });

    expect(Array.isArray(atRiskStudents)).toBe(true);
    const blockedCount = await Student.count({ where: { status: "blocked" } });
    expect(blockedCount).toBeGreaterThanOrEqual(80);

    console.log(`Scenario at-risk-batch: ${elapsed}ms, atRisk returned=${atRiskStudents.length}`);
  });

  test("5) DASHBOARD LOAD STRESS (100 repeated summary calls)", async () => {
    await resetDatabase();

    await Student.bulkCreate(
      Array.from({ length: 300 }, (_, i) => ({
        name: `dashboard-${i}`,
        phone: `+50938${String(100000 + i).slice(-6)}`,
        status: randomStatus(),
        created_at: new Date(),
        last_action_at: i % 2 === 0 ? new Date(Date.now() - 2 * DAY_MS) : new Date()
      }))
    );

    const started = startMetric();
    const times = [];

    for (let i = 0; i < 100; i += 1) {
      const t0 = startMetric();
      const { result: response } = await withMetric("GET /api/activation/dashboard/summary", () =>
        request(app).get("/api/activation/dashboard/summary").set(authHeaders())
      );
      const t = endMetric("DASHBOARD_SINGLE_CALL", t0, response.status === 200);
      times.push(t);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(/application\/json/);
      expect(response.body.paid_training).toBeDefined();
      expect(response.body.active).toBeDefined();
      expect(Array.isArray(response.body.at_risk_students)).toBe(true);
    }

    const elapsed = endMetric("SCENARIO5_DASHBOARD_LOAD", started, true);
    scenarioReports.push({ scenario: "dashboard-load", elapsedMs: elapsed });

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);

    console.log(`Scenario dashboard-load: ${elapsed}ms total, avg=${avg.toFixed(2)}ms, max=${max}ms`);
    expect(avg).toBeLessThan(500);
  });

  test("6) MIXED REALISTIC WORKLOAD SIMULATION", async () => {
    await resetDatabase();

    const started = startMetric();

    const createJobs = Array.from({ length: 100 }, (_, i) => i);
    const createResponses = await runInBatches(
      createJobs,
      async (i) =>
        withMetric("POST /api/activation/students", () =>
          request(app).post("/api/activation/students").set(authHeaders()).send({
            name: `cycle-${i}`,
            phone: `+50939${String(100000 + i).slice(-6)}`,
            status: "paid_training"
          })
        ),
      20
    );

    createResponses.forEach(({ result: response }) => {
      expect(response.status).toBe(201);
    });

    const students = createResponses.map(({ result }) => result.body);

    const actionJobs = Array.from({ length: 60 }, (_, i) => ({ i, student: students[i % students.length] }));
    const actionsBurst = await runInBatches(
      actionJobs,
      async (job) => {
        const type = ["onboarding", "step1", "support", "message", "activation"][job.i % 5];
        return withMetric("POST /api/activation/students/:id/actions", () =>
          request(app)
            .post(`/api/activation/students/${job.student.id}/actions`)
            .set(authHeaders())
            .send({ type, content: `cycle action ${job.i}` })
        );
      },
      10
    );

    actionsBurst.forEach(({ result: response }) => {
      expect(response.status).toBe(201);
    });

    const statusBatch = await runInBatches(
      students.slice(0, 20),
      async (student) =>
        withMetric("PATCH /api/activation/students/:id/status", () =>
          request(app)
            .patch(`/api/activation/students/${student.id}/status`)
            .set(authHeaders())
            .send({ status: "onboarding_start" })
        ),
      10
    );

    statusBatch.forEach(({ result: response }) => {
      expect(response.status).toBe(200);
      expect(response.body.status).toBe("onboarding");
    });

    const dashboardBurst = await Promise.all(
      Array.from({ length: 10 }, () =>
        withMetric("GET /api/activation/dashboard/summary", () =>
          request(app).get("/api/activation/dashboard/summary").set(authHeaders())
        )
      )
    );

    dashboardBurst.forEach(({ result: response }) => {
      expect(response.status).toBe(200);
    });

    const { result: batchOutcome } = await withMetric("SERVICE checkAtRiskStudents", () =>
      activationService.checkAtRiskStudents()
    );

    expect(Array.isArray(batchOutcome)).toBe(true);

    const elapsed = endMetric("SCENARIO6_MIXED_WORKLOAD", started, true);
    scenarioReports.push({ scenario: "mixed-workload", elapsedMs: elapsed });

    console.log(`Scenario mixed-workload: ${elapsed}ms end-to-end`);
  });
});
