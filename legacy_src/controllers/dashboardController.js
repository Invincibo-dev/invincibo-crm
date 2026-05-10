const { Op, fn, col } = require("sequelize");
const { Student } = require("../models");

const DEFAULT_COUNTS = {
  paid_training: 0,
  onboarding: 0,
  step1: 0,
  active: 0,
  inactive: 0,
  blocked: 0
};

const getDashboardSummary = async (_req, res, next) => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [statusRows, atRiskStudents] = await Promise.all([
      Student.findAll({
        attributes: ["status", [fn("COUNT", col("id")), "count"]],
        group: ["status"],
        raw: true
      }),
      Student.findAll({
        attributes: ["id", "name", "phone", "status", "last_action_at", "created_at"],
        where: {
          [Op.or]: [
            { last_action_at: { [Op.lte]: cutoff } },
            {
              [Op.and]: [
                { last_action_at: null },
                { created_at: { [Op.lte]: cutoff } }
              ]
            }
          ]
        },
        order: [["last_action_at", "ASC"], ["created_at", "ASC"]]
      })
    ]);

    const counts = { ...DEFAULT_COUNTS };
    for (const row of statusRows) {
      if (Object.prototype.hasOwnProperty.call(counts, row.status)) {
        counts[row.status] = Number(row.count) || 0;
      }
    }

    return res.json({
      ...counts,
      at_risk_students: atRiskStudents
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getDashboardSummary
};