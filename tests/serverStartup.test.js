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

  test("listens promptly, then marks ready after database authentication", async () => {
    const order = [];
    sequelize.authenticate.mockImplementation(async () => order.push("database"));
    app.listen.mockImplementation((_port, callback) => {
      order.push("listen");
      callback();
      return { close: jest.fn() };
    });

    const { ready } = startServer();
    await ready;

    expect(order).toEqual(["listen", "database"]);
    expect(runtimeState.isReady()).toBe(true);
  });

  test("stays not-ready when database authentication fails", async () => {
    sequelize.authenticate.mockRejectedValue(new Error("database unavailable"));

    const { ready } = startServer();
    await expect(ready).rejects.toThrow("database unavailable");
    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(runtimeState.isReady()).toBe(false);
  });
});
