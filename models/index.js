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
  Task
};
