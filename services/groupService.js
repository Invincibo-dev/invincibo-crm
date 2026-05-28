const crypto = require("crypto");
const { Op } = require("sequelize");
const {
  sequelize,
  ContactGroup,
  ContactGroupMember,
  Lead,
  Student,
  StudentAction,
  Message,
  AuditLog
} = require("../models");
const leadWhatsappService = require("./whatsappService");
const studentWhatsappService = require("./activation/whatsappService");

const CONTACT_TYPES = ["lead", "student"];
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const WHATSAPP_COOLDOWN_HOURS = Number(process.env.WHATSAPP_COOLDOWN_HOURS || 6);
const WHATSAPP_COOLDOWN_MS = WHATSAPP_COOLDOWN_HOURS * 60 * 60 * 1000;
const dryRunPreviews = new Map();

const normalize = (value) => String(value || "").trim();
const toPositiveInt = (value) => Number.parseInt(value, 10);
const normalizePhone = (value) => String(value || "").replace(/[^\d+]/g, "");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const ensureId = (value, name) => {
  const id = toPositiveInt(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw createError(`Invalid ${name}`, 400);
  }
  return id;
};

const ensureGroup = async (groupId, transaction) => {
  const group = await ContactGroup.findByPk(ensureId(groupId, "groupId"), { transaction });
  if (!group) {
    throw createError("Group not found", 404);
  }
  return group;
};

const normalizeContactType = (value) => {
  const type = normalize(value).toLowerCase();
  if (!CONTACT_TYPES.includes(type)) {
    throw createError("Invalid contact_type", 400);
  }
  return type;
};

const renderTemplate = (template, contact, groupName) => {
  return normalize(template)
    .replaceAll("{{name}}", contact.name || "")
    .replaceAll("{{phone}}", contact.phone || "")
    .replaceAll("{{groupName}}", groupName || "");
};

const splitDelimitedLine = (line, delimiter) => {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
};

const detectDelimiter = (line) => {
  return [",", ";", "\t"]
    .map((delimiter) => ({ delimiter, count: splitDelimitedLine(line, delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
};

const normalizeHeader = (value) => normalize(value).toLowerCase().replace(/[^a-z0-9_-]/g, "");

const parseCsvContacts = (csvText) => {
  const lines = normalize(csvText).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitDelimitedLine(lines[0], delimiter).map(normalizeHeader);
  const indexes = {
    name: headers.findIndex((header) => ["name", "nom"].includes(header)),
    phone: headers.findIndex((header) => ["phone", "telephone"].includes(header)),
    email: headers.findIndex((header) => header === "email"),
    problem_reason: headers.findIndex((header) => ["problem_reason", "problem", "probleme", "raison"].includes(header)),
    notes: headers.findIndex((header) => ["notes", "note"].includes(header))
  };
  const hasHeader = indexes.name >= 0 || indexes.phone >= 0;
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => {
    const columns = splitDelimitedLine(line, delimiter);
    return {
      name: columns[indexes.name >= 0 ? indexes.name : 0] || "",
      phone: normalizePhone(columns[indexes.phone >= 0 ? indexes.phone : 1] || ""),
      email: columns[indexes.email >= 0 ? indexes.email : 2] || "",
      problem_reason: columns[indexes.problem_reason >= 0 ? indexes.problem_reason : 3] || "",
      notes: columns[indexes.notes >= 0 ? indexes.notes : 4] || ""
    };
  });
};

const getGroupById = async (groupId) => ensureGroup(groupId);

const serializeGroup = async (group) => {
  const members = await ContactGroupMember.findAll({
    where: { group_id: group.id },
    order: [["created_at", "DESC"]]
  });

  const serializedMembers = await Promise.all(members.map(async (member) => {
    const contact = member.contact_type === "lead"
      ? await Lead.findByPk(member.contact_id, { attributes: ["id", "name", "phone", "email", "status"] })
      : await Student.findByPk(member.contact_id, { attributes: ["id", "name", "phone", "status"] });
    return {
      id: member.id,
      group_id: member.group_id,
      contact_type: member.contact_type,
      contact_id: member.contact_id,
      problem_reason: member.problem_reason,
      notes: member.notes,
      created_at: member.created_at,
      updated_at: member.updated_at,
      contact
    };
  }));

  return {
    ...group.toJSON(),
    members: serializedMembers
  };
};

const listGroups = async () => {
  const groups = await ContactGroup.findAll({ order: [["created_at", "DESC"]] });
  const counts = await ContactGroupMember.findAll({
    attributes: ["group_id", [sequelize.fn("COUNT", sequelize.col("id")), "total"]],
    group: ["group_id"],
    raw: true
  });
  const countsByGroup = counts.reduce((acc, row) => {
    acc[row.group_id] = Number(row.total) || 0;
    return acc;
  }, {});

  return groups.map((group) => ({
    ...group.toJSON(),
    members_count: countsByGroup[group.id] || 0
  }));
};

const createGroup = ({ name, description = "", category = "", isActive = true, createdBy = null }) => {
  const groupName = normalize(name);
  if (!groupName) {
    throw createError("name is required", 400);
  }
  return ContactGroup.create({
    name: groupName,
    description: normalize(description) || null,
    category: normalize(category) || null,
    is_active: isActive !== false,
    created_by: createdBy || null,
    created_at: new Date(),
    updated_at: new Date()
  });
};

const updateGroup = async ({ groupId, name, description, category = "", isActive = true }) => {
  const group = await ensureGroup(groupId);
  const groupName = normalize(name);
  if (!groupName) {
    throw createError("name is required", 400);
  }
  group.name = groupName;
  group.description = normalize(description) || null;
  group.category = normalize(category) || null;
  group.is_active = isActive !== false;
  group.updated_at = new Date();
  await group.save();
  return group;
};

const deleteGroup = async (groupId) => {
  const group = await ensureGroup(groupId);
  await group.destroy();
  return { deleted: true };
};

const ensureContactExists = async ({ contactType, contactId, transaction }) => {
  const model = contactType === "lead" ? Lead : Student;
  const contact = await model.findByPk(contactId, { transaction });
  if (!contact) {
    throw createError("Contact not found", 404);
  }
  return contact;
};

const addMember = async ({ groupId, contactType, contactId, problemReason = "", notes = "" }) => {
  const parsedGroupId = ensureId(groupId, "groupId");
  const type = normalizeContactType(contactType);
  const parsedContactId = ensureId(contactId, "contactId");

  return sequelize.transaction(async (transaction) => {
    await ensureGroup(parsedGroupId, transaction);
    await ensureContactExists({ contactType: type, contactId: parsedContactId, transaction });

    const [member, created] = await ContactGroupMember.findOrCreate({
      where: {
        group_id: parsedGroupId,
        contact_type: type,
        contact_id: parsedContactId
      },
      defaults: {
        group_id: parsedGroupId,
        contact_type: type,
        contact_id: parsedContactId,
        problem_reason: normalize(problemReason) || null,
        notes: normalize(notes) || null,
        created_at: new Date(),
        updated_at: new Date()
      },
      transaction
    });

    return { member, created };
  });
};

const listMembers = async (groupId) => {
  const group = await ensureGroup(groupId);
  return (await serializeGroup(group)).members;
};

const updateMember = async ({ groupId, memberId, problemReason = "", notes = "" }) => {
  await ensureGroup(groupId);
  const member = await ContactGroupMember.findOne({
    where: {
      id: ensureId(memberId, "memberId"),
      group_id: ensureId(groupId, "groupId")
    }
  });
  if (!member) {
    throw createError("Member not found", 404);
  }
  member.problem_reason = normalize(problemReason) || null;
  member.notes = normalize(notes) || null;
  member.updated_at = new Date();
  await member.save();
  return member;
};

const removeMember = async ({ groupId, memberId }) => {
  await ensureGroup(groupId);
  const member = await ContactGroupMember.findOne({
    where: {
      id: ensureId(memberId, "memberId"),
      group_id: ensureId(groupId, "groupId")
    }
  });
  if (!member) {
    throw createError("Member not found", 404);
  }
  await member.destroy();
  return { deleted: true };
};

const importCsv = async ({ groupId, csvText }) => {
  const group = await ensureGroup(groupId);
  const rows = parseCsvContacts(csvText);
  const summary = {
    total_rows: rows.length,
    created: 0,
    existing: 0,
    added_to_group: 0,
    duplicates_ignored: 0,
    invalid: 0
  };

  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    if (!row.name || !phone || phone.replace(/[^\d]/g, "").length < 8) {
      summary.invalid += 1;
      continue;
    }

    const [lead, created] = await Lead.findOrCreate({
      where: { phone },
      defaults: {
        name: row.name,
        phone,
        email: row.email || null,
        source: "group_import",
        status: "new"
      }
    });

    if (created) {
      summary.created += 1;
    } else {
      summary.existing += 1;
    }

    const { created: memberCreated } = await addMember({
      groupId: group.id,
      contactType: "lead",
      contactId: lead.id,
      problemReason: row.problem_reason,
      notes: row.notes
    });
    if (memberCreated) {
      summary.added_to_group += 1;
    } else {
      summary.duplicates_ignored += 1;
    }
  }

  return summary;
};

const getRecipients = async (group) => {
  const members = await ContactGroupMember.findAll({
    where: { group_id: group.id },
    order: [["id", "ASC"]]
  });

  const recipients = [];
  for (const member of members) {
    const contact = member.contact_type === "lead"
      ? await Lead.findByPk(member.contact_id)
      : await Student.findByPk(member.contact_id);
    if (contact) {
      recipients.push({
        member_id: member.id,
        contact_type: member.contact_type,
        contact_id: member.contact_id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email || null,
        raw: contact
      });
    }
  }
  return recipients;
};

const previewToken = ({ groupId, userId, messageTemplate }) => {
  return crypto
    .createHash("sha256")
    .update(`${groupId}:${userId || "anon"}:${messageTemplate}:${Date.now()}:${crypto.randomBytes(8).toString("hex")}`)
    .digest("hex");
};

const validatePreview = ({ previewToken: token, groupId, userId, messageTemplate }) => {
  const preview = dryRunPreviews.get(token);
  if (!preview) {
    return false;
  }
  if (preview.expires_at < Date.now()) {
    dryRunPreviews.delete(token);
    return false;
  }
  return preview.group_id === groupId && preview.user_id === (userId || null) && preview.message_template === messageTemplate;
};

const checkStudentCooldown = async ({ studentId, message, now }) => {
  const minDate = new Date(now.getTime() - WHATSAPP_COOLDOWN_MS);
  const recent = await StudentAction.findOne({
    where: {
      student_id: studentId,
      created_at: { [Op.gte]: minDate },
      content: { [Op.like]: `%${message}%` }
    }
  });
  return Boolean(recent);
};

const checkLeadCooldown = async ({ leadId, message, now }) => {
  const minDate = new Date(now.getTime() - WHATSAPP_COOLDOWN_MS);
  const recent = await Message.findOne({
    where: {
      lead_id: leadId,
      created_at: { [Op.gte]: minDate },
      message
    }
  });
  return Boolean(recent);
};

const logLeadAttempt = async ({ leadId, message, status }) => {
  return Message.create({
    lead_id: leadId,
    message,
    type: "followup",
    status
  });
};

const logStudentAttempt = async ({ student, message, status, detail = "" }) => {
  const now = new Date();
  await StudentAction.create({
    student_id: student.id,
    type: "message",
    content: `[group:${status}]${detail ? ` ${detail}` : ""} ${message}`,
    created_at: now
  });
  student.last_action_at = now;
  await student.save();
};

const sendMessage = async ({ groupId, messageTemplate, dryRun = true, userId = null, token = null, req = null }) => {
  const group = await ensureGroup(groupId);
  const template = normalize(messageTemplate);
  if (!template) {
    throw createError("message_template is required", 400);
  }

  const recipients = await getRecipients(group);
  const rendered = recipients.map((recipient) => ({
    member_id: recipient.member_id,
    contact_type: recipient.contact_type,
    contact_id: recipient.contact_id,
    name: recipient.name,
    phone: recipient.phone,
    message: renderTemplate(template, recipient, group.name)
  }));

  if (dryRun) {
    const generatedToken = previewToken({ groupId: group.id, userId, messageTemplate: template });
    dryRunPreviews.set(generatedToken, {
      group_id: group.id,
      user_id: userId || null,
      message_template: template,
      expires_at: Date.now() + PREVIEW_TTL_MS
    });
    return {
      dry_run: true,
      preview_token: generatedToken,
      expires_in_seconds: Math.floor(PREVIEW_TTL_MS / 1000),
      total_targets: rendered.length,
      recipients: rendered
    };
  }

  if (!validatePreview({ previewToken: token, groupId: group.id, userId, messageTemplate: template })) {
    throw createError("dry_run is required before sending this group message", 409);
  }

  const summary = {
    total_targets: rendered.length,
    sent: 0,
    skipped_cooldown: 0,
    errors: 0,
    results: []
  };
  const now = new Date();

  for (const item of rendered) {
    const recipient = recipients.find((row) => row.member_id === item.member_id);
    const isCooldown = item.contact_type === "student"
      ? await checkStudentCooldown({ studentId: item.contact_id, message: item.message, now })
      : await checkLeadCooldown({ leadId: item.contact_id, message: item.message, now });

    if (isCooldown) {
      summary.skipped_cooldown += 1;
      summary.results.push({ ...item, status: "skipped_cooldown" });
      continue;
    }

    try {
      const sendResult = process.env.NODE_ENV === "test"
        ? { success: true, statusCode: 200, mock: true }
        : item.contact_type === "student"
          ? await studentWhatsappService.sendMessage(item.phone, item.message)
          : await leadWhatsappService.sendWhatsAppMessage(item.phone, item.name, item.message);
      const success = item.contact_type === "lead" ? Boolean(sendResult) : Boolean(sendResult?.success);

      if (item.contact_type === "student") {
        await logStudentAttempt({
          student: recipient.raw,
          message: item.message,
          status: success ? "sent" : "failed",
          detail: `status=${sendResult?.statusCode || "n/a"}`
        });
      } else {
        await logLeadAttempt({ leadId: item.contact_id, message: item.message, status: success ? "sent" : "failed" });
      }

      if (success) {
        summary.sent += 1;
      } else {
        summary.errors += 1;
      }
      summary.results.push({ ...item, status: success ? "sent" : "failed" });
    } catch (error) {
      summary.errors += 1;
      summary.results.push({ ...item, status: "error", error: error.message });
      if (item.contact_type === "student") {
        await logStudentAttempt({ student: recipient.raw, message: item.message, status: "failed", detail: error.message });
      } else {
        await logLeadAttempt({ leadId: item.contact_id, message: item.message, status: "failed" });
      }
    }
  }

  dryRunPreviews.delete(token);
  await AuditLog.create({
    user_id: userId || null,
    action: "GROUP_MESSAGE_SENT",
    entity: "contact_group",
    entity_id: group.id,
    ip: req?.ip || null,
    meta_json: JSON.stringify({
      total_targets: summary.total_targets,
      sent: summary.sent,
      skipped_cooldown: summary.skipped_cooldown,
      errors: summary.errors
    })
  });

  return summary;
};

module.exports = {
  listGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
  addMember,
  listMembers,
  updateMember,
  removeMember,
  importCsv,
  sendMessage,
  serializeGroup,
  parseCsvContacts
};
