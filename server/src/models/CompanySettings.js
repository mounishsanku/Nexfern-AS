const mongoose = require("mongoose");

const companySettingsSchema = new mongoose.Schema(
  {
    defaultEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      default: null,
    },
    defaultCurrency: { type: String },
    features: {
      USE_NEW_LOCALIZATION_ENGINE: { type: Boolean, default: false },
      USE_MULTI_CURRENCY_ENGINE: { type: Boolean, default: false },
      USE_GENERIC_TAX_ENGINE: { type: Boolean, default: false },
      USE_IMPORT_ENGINE: { type: Boolean, default: false },
      USE_SECURITY_HARDENING: { type: Boolean, default: false },
      USE_ENCRYPTED_BACKUPS: { type: Boolean, default: false },
      USE_INTEGRATIONS: { type: Boolean, default: false },
      USE_PAYMENT_GATEWAYS: { type: Boolean, default: false },
      USE_BANK_FEEDS: { type: Boolean, default: false },
      USE_ADVANCED_RECONCILIATION: { type: Boolean, default: false },
      USE_MATCH_SCORING: { type: Boolean, default: false },
      USE_ANALYTICS_ENGINE: { type: Boolean, default: false },
      USE_REPORT_CACHE: { type: Boolean, default: false },
      USE_EXECUTIVE_DASHBOARD: { type: Boolean, default: false },
      USE_MONITORING: { type: Boolean, default: false },
      USE_ALERTING: { type: Boolean, default: false },
      USE_BACKGROUND_JOBS: { type: Boolean, default: false },
      USE_RATE_LIMITING: { type: Boolean, default: false },
      USE_HELP_CENTER: { type: Boolean, default: false },
      USE_GUIDED_ONBOARDING: { type: Boolean, default: false },
      USE_RELEASE_GATES: { type: Boolean, default: false },
      USE_STRICT_TEST_MODE: { type: Boolean, default: false }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("CompanySettings", companySettingsSchema);
