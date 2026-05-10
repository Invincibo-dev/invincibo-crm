const { AuditLog } = require("../models");

const normalizeMeta = (meta) => {
  if (!meta) {
    return null;
  }
  try {
    return JSON.stringify(meta);
  } catch (_error) {
    return JSON.stringify({ serialization_error: true });
  }
};

const recordAudit = async (req, { action, entity, entityId = null, meta = null }) => {
  try {
    await AuditLog.create({
      user_id: req.user?.id || null,
      action,
      entity,
      entity_id: entityId,
      ip: req.ip,
      meta_json: normalizeMeta(meta)
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("[AUDIT] failed to persist log", error.message);
    }
  }
};

module.exports = {
  recordAudit
};
