const { XMLParser } = require("fast-xml-parser");
const logger = require("../utils/logger");

/**
 * TallyParser - Handles parsing of Tally XML exports (masters.xml, vouchers.xml).
 * 
 * Maps Tally XML tags to Nexfern-compatible JSON objects.
 */
class TallyParser {
  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      allowBooleanAttributes: true,
    });
  }

  /**
   * Parse Tally XML buffer and return normalized rows based on type.
   */
  parse(buffer, type) {
    const xmlStr = buffer.toString("utf8");
    const jsonObj = this.parser.parse(xmlStr);

    // Tally XML usually nests under ENVELOPE -> BODY -> DATA -> COLLECTION
    const collection = jsonObj?.ENVELOPE?.BODY?.DATA?.COLLECTION;
    if (!collection) {
      throw new Error("Invalid Tally XML format: Missing COLLECTION tag");
    }

    if (type === "customer" || type === "vendor") {
      return this.extractLedgers(collection, type);
    } else if (type === "invoice") {
      return this.extractVouchers(collection, "Sales");
    } else if (type === "payment") {
      return this.extractVouchers(collection, "Payment");
    } else if (type === "expense") {
      // In Tally, expenses are often Vouchers of type 'Payment' or 'Purchase'
      return this.extractVouchers(collection, "Purchase");
    }

    throw new Error(`Tally import not yet implemented for type: ${type}`);
  }

  /**
   * Helper to get value from attribute or child tag
   */
  getValue(obj, key) {
    return obj[`@_${key}`] || obj[key] || null;
  }

  /**
   * Extract Ledger masters (Customers/Vendors).
   */
  extractLedgers(collection, targetType) {
    let ledgers = collection.LEDGER || [];
    if (!Array.isArray(ledgers)) ledgers = [ledgers];

    const results = [];
    const parentFilter = targetType === "customer" ? "Sundry Debtors" : "Sundry Creditors";

    for (const l of ledgers) {
      const name = this.getValue(l, "NAME");
      const parent = this.getValue(l, "PARENT");

      if (parent && !parent.includes(parentFilter)) continue;
      if (!name) continue;

      results.push({
        name: String(name).trim(),
        email: this.getValue(l, "EMAILID"),
        phone: this.getValue(l, "LEDPHONE"),
        addressLine1: Array.isArray(l.ADDRESS) ? l.ADDRESS[0] : (l.ADDRESS || null),
        gstin: this.getValue(l, "GSTOUPUTGSTIN") || this.getValue(l, "PARTYGSTIN"),
        tallyGuid: this.getValue(l, "GUID"),
      });
    }

    return results;
  }

  /**
   * Extract Vouchers (Invoices/Payments/Purchases).
   */
  extractVouchers(collection, tallyVoucherType) {
    let vouchers = collection.VOUCHER || [];
    if (!Array.isArray(vouchers)) vouchers = [vouchers];

    const results = [];
    for (const v of vouchers) {
      const vType = this.getValue(v, "VOUCHERTYPENAME");
      if (vType !== tallyVoucherType) continue;

      const date = this.formatTallyDate(this.getValue(v, "DATE"));
      const amount = Math.abs(parseFloat(this.getValue(v, "AMOUNT") || 0));
      const partyName = this.getValue(v, "PARTYLEDGERNAME");
      
      results.push({
        tallyVoucherNumber: this.getValue(v, "VOUCHERNUMBER"),
        date,
        amount,
        partyName,
        narration: this.getValue(v, "NARRATION") || "",
        tallyGuid: this.getValue(v, "GUID"),
      });
    }

    return results;
  }

  /**
   * Tally dates are usually YYYYMMDD
   */
  formatTallyDate(tallyDate) {
    if (!tallyDate) return new Date();
    const str = String(tallyDate);
    if (str.length === 8) {
      const y = str.substring(0, 4);
      const m = str.substring(4, 6);
      const d = str.substring(6, 8);
      return new Date(`${y}-${m}-${d}`);
    }
    return new Date(tallyDate);
  }
}

module.exports = new TallyParser();
