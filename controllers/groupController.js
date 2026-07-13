const groupService = require("../services/groupService");
const { getPagination, sendCollection } = require("../services/pagination");

const createGroup = async (req, res, next) => {
  try {
    const group = await groupService.createGroup({
      name: req.body?.name,
      description: req.body?.description,
      category: req.body?.category,
      isActive: req.body?.is_active,
      createdBy: req.user?.id || null
    });
    return res.status(201).json(group);
  } catch (error) {
    return next(error);
  }
};

const listGroups = async (req, res, next) => {
  try {
    const pagination = getPagination(req.query);
    const { rows, count } = await groupService.listGroups(pagination);
    return sendCollection(res, rows, count, pagination);
  } catch (error) {
    return next(error);
  }
};

const getGroup = async (req, res, next) => {
  try {
    const group = await groupService.getGroupById(req.params.id);
    const detailed = await groupService.serializeGroup(group);
    return res.json(detailed);
  } catch (error) {
    return next(error);
  }
};

const updateGroup = async (req, res, next) => {
  try {
    const group = await groupService.updateGroup({
      groupId: req.params.id,
      name: req.body?.name,
      description: req.body?.description,
      category: req.body?.category,
      isActive: req.body?.is_active
    });
    return res.json(group);
  } catch (error) {
    return next(error);
  }
};

const deleteGroup = async (req, res, next) => {
  try {
    const result = await groupService.deleteGroup(req.params.id);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

const addMember = async (req, res, next) => {
  try {
    const { member, created } = await groupService.addMember({
      groupId: req.params.id,
      contactType: req.body?.contact_type,
      contactId: req.body?.contact_id,
      problemReason: req.body?.problem_reason,
      notes: req.body?.notes
    });
    return res.status(created ? 201 : 200).json(member);
  } catch (error) {
    return next(error);
  }
};

const listMembers = async (req, res, next) => {
  try {
    const members = await groupService.listMembers(req.params.id);
    return res.json(members);
  } catch (error) {
    return next(error);
  }
};

const updateMember = async (req, res, next) => {
  try {
    const member = await groupService.updateMember({
      groupId: req.params.id,
      memberId: req.params.memberId,
      problemReason: req.body?.problem_reason,
      notes: req.body?.notes
    });
    return res.json(member);
  } catch (error) {
    return next(error);
  }
};

const removeMember = async (req, res, next) => {
  try {
    const result = await groupService.removeMember({
      groupId: req.params.id,
      memberId: req.params.memberId
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

const importCsv = async (req, res, next) => {
  try {
    const summary = await groupService.importCsv({
      groupId: req.params.id,
      csvText: req.body?.csv || req.body?.text || ""
    });
    return res.json(summary);
  } catch (error) {
    return next(error);
  }
};

const sendMessage = async (req, res, next) => {
  try {
    const result = await groupService.sendMessage({
      groupId: req.params.id,
      messageTemplate: req.body?.message_template,
      dryRun: req.body?.dry_run !== false,
      token: req.body?.preview_token,
      userId: req.user?.id || null,
      req
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createGroup,
  listGroups,
  getGroup,
  updateGroup,
  deleteGroup,
  addMember,
  listMembers,
  updateMember,
  removeMember,
  importCsv,
  sendMessage
};
