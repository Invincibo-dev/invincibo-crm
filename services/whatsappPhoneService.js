const MIN_E164_DIGITS = 7;
const MAX_E164_DIGITS = 15;

const normalizeWhatsAppPhone = (value) => {
  const compact = String(value || "")
    .trim()
    .replace(/[\s()+-]/g, "");
  if (!/^\d+$/.test(compact)) return null;
  if (compact.length < MIN_E164_DIGITS || compact.length > MAX_E164_DIGITS) return null;
  return compact;
};

module.exports = { MAX_E164_DIGITS, MIN_E164_DIGITS, normalizeWhatsAppPhone };
