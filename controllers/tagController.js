const { Lead, Tag, LeadTag, sequelize } = require("../models");
const { updateLeadScore } = require("../services/scoreService");
const { recordAudit } = require("../services/auditService");

const createTag = async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) {
      return res.status(400).json({ message: "Tag name is required" });
    }

    const existingTag = await Tag.findOne({ where: { name } });
    if (existingTag) {
      return res.status(409).json({ message: "Tag already exists", tag: existingTag });
    }

    const tag = await Tag.create({ name });
    await recordAudit(req, {
      action: "TAG_CREATED",
      entity: "tag",
      entityId: tag.id,
      meta: { name: tag.name }
    });
    return res.status(201).json(tag);
  } catch (error) {
    return next(error);
  }
};

const getTags = async (_req, res, next) => {
  try {
    const tags = await Tag.findAll({ order: [["name", "ASC"]] });
    return res.json(tags);
  } catch (error) {
    return next(error);
  }
};

const addTagToLead = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const leadId = Number(req.params.id);
    const tagId = Number(req.body.tag_id);

    if (!leadId || !tagId) {
      await transaction.rollback();
      return res.status(400).json({ message: "lead id and tag_id are required" });
    }

    const [lead, tag] = await Promise.all([
      Lead.findByPk(leadId, { transaction }),
      Tag.findByPk(tagId, { transaction })
    ]);

    if (!lead) {
      await transaction.rollback();
      return res.status(404).json({ message: "Lead not found" });
    }
    if (!tag) {
      await transaction.rollback();
      return res.status(404).json({ message: "Tag not found" });
    }

    const existingLink = await LeadTag.findOne({
      where: { lead_id: leadId, tag_id: tagId },
      transaction
    });
    if (existingLink) {
      await transaction.rollback();
      return res.status(409).json({ message: "Tag already assigned to this lead" });
    }

    const leadTag = await LeadTag.create(
      {
        lead_id: leadId,
        tag_id: tagId
      },
      { transaction }
    );

    await updateLeadScore(leadId, { transaction });
    await transaction.commit();
    await recordAudit(req, {
      action: "TAG_ADDED_TO_LEAD",
      entity: "lead_tag",
      entityId: leadTag.id,
      meta: { lead_id: leadId, tag_id: tagId }
    });

    return res.status(201).json({
      message: "Tag added to lead successfully",
      leadTag
    });
  } catch (error) {
    await transaction.rollback();
    return next(error);
  }
};

const getLeadTags = async (req, res, next) => {
  try {
    const leadId = Number(req.params.id);
    const lead = await Lead.findByPk(leadId);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    const leadTags = await LeadTag.findAll({
      where: { lead_id: leadId },
      include: [{ model: Tag, as: "tag", attributes: ["id", "name", "created_at"] }],
      order: [["id", "DESC"]]
    });

    return res.json(
      leadTags.map((row) => ({
        id: row.tag.id,
        name: row.tag.name,
        created_at: row.tag.created_at
      }))
    );
  } catch (error) {
    return next(error);
  }
};

const removeTagFromLead = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const leadId = Number(req.params.leadId);
    const tagId = Number(req.params.tagId);

    const leadTag = await LeadTag.findOne({
      where: { lead_id: leadId, tag_id: tagId },
      transaction
    });

    if (!leadTag) {
      await transaction.rollback();
      return res.status(404).json({ message: "Lead tag relation not found" });
    }

    await leadTag.destroy({ transaction });
    await updateLeadScore(leadId, { transaction });
    await transaction.commit();
    await recordAudit(req, {
      action: "TAG_REMOVED_FROM_LEAD",
      entity: "lead_tag",
      entityId: leadTag.id,
      meta: { lead_id: leadId, tag_id: tagId }
    });

    return res.json({ message: "Tag removed from lead successfully" });
  } catch (error) {
    await transaction.rollback();
    return next(error);
  }
};

module.exports = {
  createTag,
  getTags,
  addTagToLead,
  getLeadTags,
  removeTagFromLead
};
