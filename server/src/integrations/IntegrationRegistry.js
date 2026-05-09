/**
 * IntegrationRegistry.js
 *
 * Central service locator for all external integration adapters.
 * Controllers MUST go through this registry — never import adapters directly.
 *
 * Flow:
 *   controller → IntegrationRegistry.getAdapter(provider) → adapter → normalizedPayload → trustedService
 */
const RazorpayAdapter = require("./payment/RazorpayAdapter");
const StripeAdapter = require("./payment/StripeAdapter");
const BankFeedAdapter = require("./bank/BankFeedAdapter");
const ZohoAdapter = require("./crm/ZohoAdapter");
const SalesforceAdapter = require("./crm/SalesforceAdapter");

const REGISTRY = {
  razorpay: RazorpayAdapter,
  stripe: StripeAdapter,
  "bank-feed": BankFeedAdapter,
  zoho: ZohoAdapter,
  salesforce: SalesforceAdapter,
};

/**
 * Returns the adapter class for a given provider string.
 * @throws if provider is not registered.
 */
function getAdapter(provider) {
  const Adapter = REGISTRY[provider];
  if (!Adapter) {
    throw new Error(`IntegrationRegistry: Unknown provider "${provider}". Registered: ${Object.keys(REGISTRY).join(", ")}`);
  }
  return Adapter;
}

/**
 * Returns all registered provider names.
 */
function listProviders() {
  return Object.keys(REGISTRY);
}

module.exports = { getAdapter, listProviders };
