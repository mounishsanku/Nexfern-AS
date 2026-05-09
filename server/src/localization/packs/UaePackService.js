const LocalizationPack = require("../interfaces/LocalizationPack");
const { resolveTaxes } = require("../../services/taxEngine");
const TaxProfile = require("../../models/TaxProfile");
const { round2 } = require("../../utils/round");

class UaePackService extends LocalizationPack {
  async validateInvoice(invoiceData, entity) {
    if (invoiceData.customerTRN) {
      const trnStr = String(invoiceData.customerTRN).trim();
      if (!/^\d{15}$/.test(trnStr)) {
        throw new Error("Invalid TRN format. Must be exactly 15 digits.");
      }
    }
    return { valid: true, parsedAmount: Number(invoiceData.amount) || 0 };
  }

  async calculateTax(invoiceData, entity) {
    const { parsedAmount } = await this.validateInvoice(invoiceData, entity);

    if (invoiceData.useGenericTaxEngine) {
      let taxProfile = await TaxProfile.findOne({ entityId: entity._id, name: "Default UAE Profile" }).populate("taxRules").lean();
      if (!taxProfile) {
        taxProfile = {
          taxRules: [
            { isActive: true, rate: 5, code: "VAT_STANDARD", name: "VAT", taxType: "VAT" }
          ]
        };
      }
      
      const result = resolveTaxes({ invoiceData, taxProfile });
      
      return {
        taxType: "VAT",
        taxLines: result.taxLines,
        cgst: 0,
        sgst: 0,
        igst: 0,
        totalTax: result.totals.totalTax,
        totalAmount: result.totals.grandTotal
      };
    }

    const vatRate = 5;
    const vatAmount = round2(parsedAmount * (vatRate / 100));
    const taxLines = [{
      name: "VAT",
      code: "VAT_STANDARD",
      rate: vatRate,
      amount: vatAmount,
      taxType: "VAT"
    }];

    return {
      taxType: "VAT",
      taxLines,
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalTax: vatAmount,
      totalAmount: round2(parsedAmount + vatAmount)
    };
  }

  getInvoiceFields() {
    return ["TRN", "placeOfSupply"];
  }

  getReports() {
    return ["VAT_RETURN"];
  }

  getCountryMetadata() {
    return {
      country: "AE",
      name: "United Arab Emirates",
      currency: "AED"
    };
  }

  getTaxType() {
    return "VAT";
  }
}

module.exports = UaePackService;
