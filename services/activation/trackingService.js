const crypto = require("crypto");
const { TrackingEvent, Student } = require("../../models");
const { AppError } = require("./errors");

const getTrackingSecret = () => {
  const secret = process.env.TRACKING_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new AppError("Tracking configuration error", 500);
  }
  return "dev_tracking_secret_change_me";
};

const normalizeType = (value) => String(value || "").trim().toLowerCase();

const getBaseUrl = () =>
  String(process.env.TRACKING_BASE_URL || "http://localhost:5000")
    .trim()
    .replace(/\/$/, "");

const getDestinationByType = (type) => {
  const map = {
    activation: process.env.TRACKING_DEST_ACTIVATION,
    onboarding: process.env.TRACKING_DEST_ONBOARDING,
    payment: process.env.TRACKING_DEST_PAYMENT
  };

  return map[type] || process.env.TRACKING_DEST_DEFAULT || getBaseUrl();
};

const base64UrlEncode = (value) => Buffer.from(value).toString("base64url");
const base64UrlDecode = (value) => Buffer.from(value, "base64url").toString("utf8");

const sign = (payloadPart) =>
  crypto.createHmac("sha256", getTrackingSecret()).update(payloadPart).digest("base64url");

const buildPayload = (studentId, type) => ({
  studentId: Number(studentId),
  actionType: type
});

const encodeToken = (payload) => {
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signaturePart = sign(payloadPart);
  return `${payloadPart}.${signaturePart}`;
};

const decodeToken = (token) => {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    throw new AppError("Invalid tracking token", 400);
  }

  const [payloadPart, signaturePart] = token.split(".");
  const expectedSignature = sign(payloadPart);

  if (signaturePart !== expectedSignature) {
    throw new AppError("Invalid tracking signature", 400);
  }

  const payload = JSON.parse(base64UrlDecode(payloadPart));

  if (!Number.isInteger(payload.studentId) || payload.studentId <= 0) {
    throw new AppError("Invalid tracking payload", 400);
  }

  const actionType = normalizeType(payload.actionType);
  if (!["activation", "onboarding", "payment"].includes(actionType)) {
    throw new AppError("Invalid tracking action type", 400);
  }

  return {
    studentId: payload.studentId,
    actionType
  };
};

const generateTrackingLink = (studentId, type) => {
  const parsedStudentId = Number.parseInt(studentId, 10);
  if (!Number.isInteger(parsedStudentId) || parsedStudentId <= 0) {
    throw new AppError("Invalid studentId for tracking link", 400);
  }

  const actionType = normalizeType(type);
  if (!["activation", "onboarding", "payment"].includes(actionType)) {
    throw new AppError("Invalid tracking link type", 400);
  }

  const payload = buildPayload(parsedStudentId, actionType);
  const token = encodeToken(payload);

  return `${getBaseUrl()}/t/${token}`;
};

const logTrackingEvent = async ({ studentId, eventType, source = "whatsapp", transaction }) => {
  return TrackingEvent.create(
    {
      student_id: studentId,
      event_type: eventType,
      source,
      created_at: new Date()
    },
    { transaction }
  );
};

const handleTrackingToken = async (token) => {
  const decoded = decodeToken(token);

  const student = await Student.findByPk(decoded.studentId, {
    attributes: ["id", "name", "status"]
  });

  if (!student) {
    throw new AppError("Student not found for tracking token", 404);
  }

  await logTrackingEvent({
    studentId: student.id,
    eventType: "click",
    source: "whatsapp"
  });

  return {
    studentId: student.id,
    actionType: decoded.actionType,
    destination: getDestinationByType(decoded.actionType)
  };
};

const logConversionEvent = async (studentId, source = "system", transaction = null) => {
  const parsedStudentId = Number.parseInt(studentId, 10);
  if (!Number.isInteger(parsedStudentId) || parsedStudentId <= 0) {
    throw new AppError("Invalid studentId for conversion log", 400);
  }

  await logTrackingEvent({
    studentId: parsedStudentId,
    eventType: "conversion",
    source,
    transaction: transaction || undefined
  });
};

module.exports = {
  generateTrackingLink,
  decodeToken,
  handleTrackingToken,
  logConversionEvent
};
