const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const defineUser = require("./user");
const defineStudent = require("./student");
const defineStudentAction = require("./studentAction");
const defineTrackingEvent = require("./trackingEvent");

const User = defineUser(sequelize, DataTypes);
const Student = defineStudent(sequelize, DataTypes);
const StudentAction = defineStudentAction(sequelize, DataTypes);
const TrackingEvent = defineTrackingEvent(sequelize, DataTypes);

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

module.exports = {
  sequelize,
  User,
  Student,
  StudentAction,
  TrackingEvent
};
