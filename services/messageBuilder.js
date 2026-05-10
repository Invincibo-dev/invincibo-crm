const MESSAGE_TEMPLATES = {
  initial:
    "{{greeting}}\nMerci pour ton interet pour notre formation GSM.\nVoici les informations completes...",
  followup1:
    "{{greeting}}\nJe voulais m'assurer que tu as bien recu les informations concernant la formation.",
  followup2:
    "{{greeting}}\nLes places se remplissent rapidement.\nDis-moi si tu souhaites reserver ta place.",
  followup3:
    "{{greeting}}\nDerniere relance avant la fermeture des inscriptions.\nNous attendons ta confirmation."
};

const normalizeText = (value) => String(value || "").trim();

const buildGreeting = (lead) => {
  if (!lead || typeof lead !== "object") {
    return "Bonjour,";
  }

  const firstName = normalizeText(lead.first_name);
  const lastName = normalizeText(lead.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  if (!fullName) {
    return "Bonjour,";
  }

  const gender = normalizeText(lead.gender).toLowerCase();
  const title = gender === "male" ? "Mr" : gender === "female" ? "Mme" : "";
  const withTitle = title ? `${title} ${fullName}` : fullName;

  return `Bonjour ${withTitle},`;
};

const buildMessage = (lead, type) => {
  const template = MESSAGE_TEMPLATES[type];
  if (!template) {
    throw new Error(`Unsupported message type: ${type}`);
  }

  const greeting = buildGreeting(lead);
  return template.replace("{{greeting}}", greeting);
};

module.exports = {
  buildGreeting,
  buildMessage,
  MESSAGE_TEMPLATES
};
