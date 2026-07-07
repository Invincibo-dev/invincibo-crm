jest.mock("node-cron", () => ({
  schedule: jest.fn(() => ({ stop: jest.fn() }))
}));

jest.mock("../services/whatsappService", () => ({
  processPendingFollowups: jest.fn()
}));

const cron = require("node-cron");
const { startFollowupCron } = require("../jobs/followupCron");

describe("follow-up cron", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("schedules the follow-up processor every five minutes", () => {
    const task = startFollowupCron();

    expect(cron.schedule).toHaveBeenCalledTimes(1);
    expect(cron.schedule).toHaveBeenCalledWith("*/5 * * * *", expect.any(Function));
    expect(task).toBeDefined();
    expect(typeof task.stop).toBe("function");
  });
});
