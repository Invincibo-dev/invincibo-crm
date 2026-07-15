const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isEmail = (value) =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const isIsoDate = (value) => !Number.isNaN(new Date(value).getTime());

const validate = (validator) => (req, res, next) => {
  const message = validator(req);
  if (message) {
    return res.status(400).json({ message });
  }
  return next();
};

const validateIdParam = (paramName = "id") =>
  validate((req) => {
    const id = Number(req.params[paramName]);
    if (!Number.isInteger(id) || id <= 0) {
      return `Invalid ${paramName} parameter`;
    }
    return null;
  });

const validateRegisterBody = validate((req) => {
  const { name, email, password, role } = req.body || {};
  if (!isNonEmptyString(name)) return "name is required";
  if (!isEmail(email)) return "Valid email is required";
  if (!isNonEmptyString(password) || String(password).length < 8) {
    return "Password must be at least 8 characters";
  }
  if (role && !["admin", "agent"].includes(String(role).toLowerCase())) {
    return "Invalid role value";
  }
  return null;
});

const validateLoginBody = validate((req) => {
  const { email, password } = req.body || {};
  if (!isEmail(email)) return "Valid email is required";
  if (!isNonEmptyString(password)) return "password is required";
  return null;
});

const validateCreateLeadBody = validate((req) => {
  const {
    first_name,
    last_name,
    name,
    phone,
    email,
    status,
    gender,
    whatsapp_opt_in,
    whatsapp_opt_in_source
  } = req.body || {};

  const hasFirst = isNonEmptyString(first_name);
  const hasLast = isNonEmptyString(last_name);
  const hasName = isNonEmptyString(name);
  if (!hasName && !hasFirst && !hasLast) {
    return "phone and at least one name field are required";
  }

  if (!isNonEmptyString(phone)) return "phone is required";
  if (email && !isEmail(email)) return "Invalid email format";
  if (status && !["new", "contacted", "client", "no_response"].includes(status)) {
    return "Invalid status value";
  }
  if (gender && !["male", "female", "unknown"].includes(gender)) {
    return "Invalid gender value";
  }
  if (whatsapp_opt_in !== undefined && typeof whatsapp_opt_in !== "boolean") {
    return "whatsapp_opt_in must be a boolean";
  }
  if (whatsapp_opt_in === true && !isNonEmptyString(whatsapp_opt_in_source)) {
    return "whatsapp_opt_in_source is required when WhatsApp consent is granted";
  }

  return null;
});

const validateUpdateLeadStatusBody = validate((req) => {
  const { status } = req.body || {};
  if (!["new", "contacted", "client", "no_response"].includes(status)) {
    return "Invalid status value";
  }
  return null;
});

const validateCreateFollowupBody = validate((req) => {
  const { lead_id, scheduled_date, message, sequence_step } = req.body || {};
  const parsedLeadId = Number(lead_id);

  if (!Number.isInteger(parsedLeadId) || parsedLeadId <= 0) {
    return "lead_id must be a positive integer";
  }
  if (!scheduled_date || !isIsoDate(scheduled_date)) {
    return "scheduled_date must be a valid date";
  }
  if (!isNonEmptyString(message)) {
    return "message is required";
  }
  if (sequence_step !== undefined) {
    const parsedStep = Number(sequence_step);
    if (!Number.isInteger(parsedStep) || parsedStep < 0) {
      return "sequence_step must be an integer >= 0";
    }
  }

  return null;
});

const validateCreateTagBody = validate((req) => {
  if (!isNonEmptyString(req.body?.name)) {
    return "Tag name is required";
  }
  return null;
});

const validateAddTagBody = validate((req) => {
  const tagId = Number(req.body?.tag_id);
  if (!Number.isInteger(tagId) || tagId <= 0) {
    return "tag_id must be a positive integer";
  }
  return null;
});

module.exports = {
  validateIdParam,
  validateRegisterBody,
  validateLoginBody,
  validateCreateLeadBody,
  validateUpdateLeadStatusBody,
  validateCreateFollowupBody,
  validateCreateTagBody,
  validateAddTagBody
};
