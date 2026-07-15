const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const getFollowUpRecoveryConfig = () => ({
  processingTimeoutMinutes: positiveInteger(process.env.FOLLOWUP_PROCESSING_TIMEOUT_MINUTES, 15),
  batchSize: Math.min(positiveInteger(process.env.FOLLOWUP_RECOVERY_BATCH_SIZE, 50), 250),
  maxAttempts: positiveInteger(
    process.env.FOLLOWUP_MAX_ATTEMPTS || process.env.WHATSAPP_FOLLOWUP_MAX_ATTEMPTS,
    3
  )
});

module.exports = { getFollowUpRecoveryConfig, positiveInteger };
