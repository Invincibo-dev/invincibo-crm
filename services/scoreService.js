const { Lead, LeadTag, FollowUp } = require("../models");

const calculateLeadScore = (lead) => {
  let score = 10;

  if (lead.status === "contacted") {
    score += 20;
  }
  if (lead.status === "client") {
    score += 100;
  }

  const tagsCount = Number(lead.tagsCount) || 0;
  score += tagsCount * 5;

  const completedFollowups = Number(lead.completedFollowups) || 0;
  if (completedFollowups > 2) {
    score += 15;
  }

  return score;
};

const updateLeadScore = async (leadId, options = {}) => {
  const transaction = options.transaction;
  const lead = await Lead.findByPk(leadId, { transaction });
  if (!lead) {
    throw new Error("Lead not found");
  }

  const [tagsCount, completedFollowups] = await Promise.all([
    LeadTag.count({ where: { lead_id: leadId }, transaction }),
    FollowUp.count({ where: { lead_id: leadId, status: "completed" }, transaction })
  ]);

  const score = calculateLeadScore({
    status: lead.status,
    tagsCount,
    completedFollowups
  });

  lead.score = score;
  await lead.save({ transaction });

  return score;
};

module.exports = {
  calculateLeadScore,
  updateLeadScore
};
