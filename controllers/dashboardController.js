const { QueryTypes, Op } = require("sequelize");
const { sequelize, Lead, Message, FollowUp } = require("../models");

const getDashboardStats = async (_req, res, next) => {
  try {
    const [
      totalLeads,
      totalClients,
      hotLeads,
      coldLeads,
      messagesSent,
      followupsPending,
      leadsByTag
    ] = await Promise.all([
      Lead.count(),
      Lead.count({ where: { status: "client" } }),
      Lead.count({ where: { score: { [Op.gte]: 50 } } }),
      Lead.count({ where: { score: { [Op.lt]: 20 } } }),
      Message.count({ where: { status: "sent" } }),
      FollowUp.count({ where: { status: "pending" } }),
      sequelize.query(
        `SELECT t.name, COUNT(lt.lead_id) as total
         FROM tags t
         LEFT JOIN lead_tags lt ON t.id = lt.tag_id
         GROUP BY t.name
         ORDER BY t.name ASC`,
        { type: QueryTypes.SELECT }
      )
    ]);

    const conversionRate =
      totalLeads === 0 ? 0 : Number(((totalClients / totalLeads) * 100).toFixed(2));

    return res.json({
      total_leads: totalLeads,
      total_clients: totalClients,
      conversion_rate: conversionRate,
      hot_leads: hotLeads,
      cold_leads: coldLeads,
      messages_sent: messagesSent,
      followups_pending: followupsPending,
      leads_by_tag: leadsByTag.map((row) => ({
        name: row.name,
        total: Number(row.total)
      }))
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getDashboardStats
};
