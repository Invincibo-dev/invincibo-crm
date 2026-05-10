const { FollowUp } = require("../models");
const { buildMessage } = require("./messageBuilder");

const MARKETING_SEQUENCE = [
  {
    step: 1,
    daysToAdd: 1
  },
  {
    step: 2,
    daysToAdd: 3
  },
  {
    step: 3,
    daysToAdd: 7
  }
];

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const generateFollowupSequence = async (lead, options = {}) => {
  const now = new Date();
  const rows = MARKETING_SEQUENCE.map((item) => ({
    lead_id: lead.id,
    scheduled_date: addDays(now, item.daysToAdd),
    message: buildMessage(lead, `followup${item.step}`),
    sequence_step: item.step,
    cancelled: false,
    status: "pending"
  }));

  const createdRows = await FollowUp.bulkCreate(rows, {
    transaction: options.transaction
  });

  return createdRows;
};

module.exports = {
  generateFollowupSequence,
  MARKETING_SEQUENCE
};
