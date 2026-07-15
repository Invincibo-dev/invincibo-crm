const sequelize = require("../config/db");
const Lead = require("./Lead");
const Message = require("./Message");
const FollowUp = require("./FollowUp");
const Tag = require("./Tag");
const LeadTag = require("./LeadTag");
const User = require("./User");
const AuditLog = require("./AuditLog");
const Student = require("./Student");
const StudentAction = require("./StudentAction");
const TrackingEvent = require("./TrackingEvent");
const Task = require("./Task");
const ContactGroup = require("./ContactGroup");
const ContactGroupMember = require("./ContactGroupMember");
const BootstrapLock = require("./BootstrapLock");
const WhatsAppWebhookEvent = require("./WhatsAppWebhookEvent");
const WhatsAppConsentEvent = require("./WhatsAppConsentEvent");

Lead.hasMany(Message, {
  foreignKey: "lead_id",
  as: "messages",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
Message.belongsTo(Lead, {
  foreignKey: "lead_id",
  as: "lead"
});

Student.hasMany(Message, {
  foreignKey: "student_id",
  as: "whatsapp_messages",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
Message.belongsTo(Student, {
  foreignKey: "student_id",
  as: "student"
});

Lead.hasMany(FollowUp, {
  foreignKey: "lead_id",
  as: "followups",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
FollowUp.belongsTo(Lead, {
  foreignKey: "lead_id",
  as: "lead"
});

FollowUp.hasOne(Message, {
  foreignKey: "followup_id",
  as: "delivery",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
Message.belongsTo(FollowUp, {
  foreignKey: "followup_id",
  as: "followup"
});

WhatsAppWebhookEvent.hasMany(Message, {
  foreignKey: "webhook_event_id",
  as: "inbound_messages",
  onDelete: "SET NULL",
  onUpdate: "CASCADE"
});
Message.belongsTo(WhatsAppWebhookEvent, {
  foreignKey: "webhook_event_id",
  as: "webhook_event"
});

User.hasMany(FollowUp, {
  foreignKey: "reviewed_by",
  as: "reviewed_followups",
  onDelete: "SET NULL",
  onUpdate: "CASCADE"
});
FollowUp.belongsTo(User, {
  foreignKey: "reviewed_by",
  as: "reviewer"
});

WhatsAppWebhookEvent.hasMany(WhatsAppConsentEvent, {
  foreignKey: "webhook_event_id",
  as: "consent_events",
  onDelete: "SET NULL",
  onUpdate: "CASCADE"
});
WhatsAppConsentEvent.belongsTo(WhatsAppWebhookEvent, {
  foreignKey: "webhook_event_id",
  as: "webhook_event"
});

User.hasMany(WhatsAppConsentEvent, {
  foreignKey: "created_by",
  as: "whatsapp_consent_events",
  onDelete: "SET NULL",
  onUpdate: "CASCADE"
});
WhatsAppConsentEvent.belongsTo(User, {
  foreignKey: "created_by",
  as: "creator"
});

Lead.belongsToMany(Tag, {
  through: LeadTag,
  foreignKey: "lead_id",
  otherKey: "tag_id",
  as: "tags"
});
Tag.belongsToMany(Lead, {
  through: LeadTag,
  foreignKey: "tag_id",
  otherKey: "lead_id",
  as: "leads"
});

Lead.hasMany(LeadTag, {
  foreignKey: "lead_id",
  as: "leadTags",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
LeadTag.belongsTo(Lead, {
  foreignKey: "lead_id",
  as: "lead"
});

Tag.hasMany(LeadTag, {
  foreignKey: "tag_id",
  as: "tagLeads",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
LeadTag.belongsTo(Tag, {
  foreignKey: "tag_id",
  as: "tag"
});

Student.hasMany(StudentAction, {
  foreignKey: "student_id",
  as: "actions",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
StudentAction.belongsTo(Student, {
  foreignKey: "student_id",
  as: "student"
});

Student.hasMany(TrackingEvent, {
  foreignKey: "student_id",
  as: "tracking_events",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
TrackingEvent.belongsTo(Student, {
  foreignKey: "student_id",
  as: "student"
});

Student.hasMany(Task, {
  foreignKey: "student_id",
  as: "tasks",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
Task.belongsTo(Student, {
  foreignKey: "student_id",
  as: "student"
});

User.hasMany(Task, {
  foreignKey: "assigned_to",
  as: "assigned_tasks",
  onDelete: "SET NULL",
  onUpdate: "CASCADE"
});
Task.belongsTo(User, {
  foreignKey: "assigned_to",
  as: "assignee"
});

User.hasMany(ContactGroup, {
  foreignKey: "created_by",
  as: "contact_groups",
  onDelete: "SET NULL",
  onUpdate: "CASCADE"
});
ContactGroup.belongsTo(User, {
  foreignKey: "created_by",
  as: "creator"
});

ContactGroup.hasMany(ContactGroupMember, {
  foreignKey: "group_id",
  as: "members",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
ContactGroupMember.belongsTo(ContactGroup, {
  foreignKey: "group_id",
  as: "group"
});

module.exports = {
  sequelize,
  Lead,
  Message,
  FollowUp,
  Tag,
  LeadTag,
  User,
  AuditLog,
  Student,
  StudentAction,
  TrackingEvent,
  Task,
  ContactGroup,
  ContactGroupMember,
  BootstrapLock,
  WhatsAppWebhookEvent,
  WhatsAppConsentEvent
};
