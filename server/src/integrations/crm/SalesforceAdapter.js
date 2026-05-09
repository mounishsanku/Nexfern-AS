/**
 * SalesforceAdapter.js — CRM sync abstraction for Salesforce.
 *
 * Status: SKELETON — establishes interface contract for future deep sync.
 * DO NOT implement live sync or tight schema coupling in this phase.
 */

class SalesforceAdapter {
  static get providerName() {
    return "salesforce";
  }

  /**
   * Maps a Salesforce Account/Contact record to a FinanceOS Customer structure.
   * Returns a normalized payload — does NOT create or update Customer records.
   */
  static normalizeCustomer(sfRecord) {
    return {
      provider: "salesforce",
      externalId: sfRecord?.Id || null,
      name: sfRecord?.Name || null,
      email: sfRecord?.PersonEmail || sfRecord?.Email || null,
      phone: sfRecord?.Phone || null,
      address: sfRecord?.BillingStreet || null,
      metadata: { source: "salesforce", raw: sfRecord },
      normalized: true,
    };
  }

  /**
   * Maps a Salesforce Opportunity to a FinanceOS Invoice structure.
   * Returns a normalized payload — does NOT create Invoice records directly.
   */
  static normalizeInvoice(sfOpportunity) {
    return {
      provider: "salesforce",
      externalId: sfOpportunity?.Id || null,
      invoiceNumber: sfOpportunity?.Name || null,
      amount: sfOpportunity?.Amount || 0,
      currency: sfOpportunity?.CurrencyIsoCode || "INR",
      status: sfOpportunity?.StageName || null,
      metadata: { source: "salesforce", raw: sfOpportunity },
      normalized: true,
    };
  }
}

module.exports = SalesforceAdapter;
