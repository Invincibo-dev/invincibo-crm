jest.mock("../app", () => ({ listen: jest.fn((_port, callback) => callback()) }));
jest.mock("../models", () => ({
  sequelize: {
    authenticate: jest.fn(),
    sync: jest.fn()
  }
}));
jest.mock("../jobs/followupCron", () => ({ startFollowupCron: jest.fn() }));

const app = require("../app");
const { sequelize } = require("../models");
const runtimeState = require("../config/runtimeState");
const { startServer } = require("../server");

describe("server startup readiness", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    runtimeState.markNotReady();
    process.env.NODE_ENV = "test";
    process.env.DB_AUTO_SYNC = "false";
    process.env.FOLLOWUP_CRON_ENABLED = "false";
  });

  test("authenticates the database before listening", async () => {
    const order = [];
    sequelize.authenticate.mockImplementation(async () => order.push("database"));
    app.listen.mockImplementation((_port, callback) => {
      order.push("listen");
      callback();
      return { close: jest.fn() };
    });

    await startServer();

    expect(order).toEqual(["database", "listen"]);
    expect(runtimeState.isReady()).toBe(true);
  });

  test("does not listen when database authentication fails", async () => {
    sequelize.authenticate.mockRejectedValue(new Error("database unavailable"));

    await expect(startServer()).rejects.toThrow("database unavailable");
    expect(app.listen).not.toHaveBeenCalled();
    expect(runtimeState.isReady()).toBe(false);
  });
});
