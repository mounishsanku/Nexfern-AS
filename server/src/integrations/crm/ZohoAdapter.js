/**
 * ZohoAdapter.js — CRM sync abstraction for Zoho CRM.
 *
 * Status: SKELETON — establishes interface contract for future deep sync.
 * DO NOT implement live sync or tight schema coupling in this phase.
 */

class ZohoAdapter {
  static get providerName() {
    return "zoho";
  }

  /**
   * Maps a Zoho Contact/Account record to a FinanceOS Customer structure.
   * Returns a normalized payload — does NOT create or update Customer records.
   */
  static normalizeCustomer(zohoRecord) {
    return {
      provider: "zoho",
      externalId: zohoRecord?.id || null,
      name: zohoRecord?.Account_Name || zohoRecord?.Full_Name || null,
      email: zohoRecord?.Email || null,
      phone: zohoRecord?.Phone || null,
      address: zohoRecord?.Billing_Street || null,
      metadata: { source: "zoho", raw: zohoRecord },
      normalized: true,
    };
  }

  /**
   * Maps a Zoho Invoice record to a FinanceOS Invoice structure.
   * Returns a normalized payload — does NOT create Invoice records directly.
   */
  static normalizeInvoice(zohoInvoice) {
    return {
      provider: "zoho",
      externalId: zohoInvoice?.invoice_id || null,
      invoiceNumber: zohoInvoice?.invoice_number || null,
      amount: zohoInvoice?.total || 0,
      currency: zohoInvoice?.currency_code || "INR",
      status: zohoInvoice?.status || null,
      metadata: { source: "zoho", raw: zohoInvoice },
      normalized: true,
    };
  }
}

module.exports = ZohoAdapter;
