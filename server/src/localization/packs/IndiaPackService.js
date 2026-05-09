const LocalizationPack = require("../interfaces/LocalizationPack");
const { round2 } = require("../../utils/round");
const TaxProfile = require("../../models/TaxProfile");
const { resolveTaxes } = require("../../services/taxEngine");

function parseNonNegativeNumber(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

class IndiaPackService extends LocalizationPack {
  async validateInvoice(invoiceData, entity) {
    // GST validation wrapper
    const { amount, gstRate, gstType } = invoiceData;
    const parsedAmount = parseNonNegativeNumber(amount);
    if (parsedAmount === null) {
      throw new Error("amount must be a non-negative number");
    }

    const normalizedGstType =
      typeof gstType === "string" && ["CGST_SGST", "IGST"].includes(gstType)
        ? gstType
        : "CGST_SGST";

    return {
      valid: true,
      parsedAmount,
      parsedRate: parseNonNegativeNumber(gstRate) ?? 0,
      normalizedGstType
    };
  }

  async calculateTax(invoiceData, entity) {
    // GST calculation wrapper
    const validation = await this.validateInvoice(invoiceData, entity);
    const { parsedAmount, parsedRate, normalizedGstType } = validation;

    if (invoiceData.useGenericTaxEngine) {
      let taxProfile = await TaxProfile.findOne({ entityId: entity._id }).populate("taxRules").lean();
      
      // Simulate GST rules if no profile found for foundational robustness
      if (!taxProfile) {
        let rules = [];
        if (parsedRate > 0) {
          if (normalizedGstType === "CGST_SGST") {
            rules.push({ isActive: true, rate: parsedRate / 2, code: "CGST", name: "CGST", taxType: "GST" });
            rules.push({ isActive: true, rate: parsedRate / 2, code: "SGST", name: "SGST", taxType: "GST" });
          } else {
            rules.push({ isActive: true, rate: parsedRate, code: "IGST", name: "IGST", taxType: "GST" });
          }
        }
        taxProfile = { taxRules: rules };
      }
      
      const result = resolveTaxes({ invoiceData, taxProfile });
      
      return {
        taxType: "GST",
        cgst: result.taxLines.find(l => l.code === "CGST")?.amount || 0,
        sgst: result.taxLines.find(l => l.code === "SGST")?.amount || 0,
        igst: result.taxLines.find(l => l.code === "IGST")?.amount || 0,
        totalTax: result.totals.totalTax,
        totalAmount: result.totals.grandTotal,
        taxLines: result.taxLines
      };
    }

    let cgst = 0, sgst = 0, igst = 0;
    const taxLines = [];

    if (parsedRate > 0) {
      if (normalizedGstType === "CGST_SGST") {
        cgst = round2(parsedAmount * (parsedRate / 2) / 100);
        sgst = round2(parsedAmount * (parsedRate / 2) / 100);
        taxLines.push({ name: "CGST", code: "CGST", rate: parsedRate / 2, amount: cgst });
        taxLines.push({ name: "SGST", code: "SGST", rate: parsedRate / 2, amount: sgst });
      } else {
        igst = round2(parsedAmount * parsedRate / 100);
        taxLines.push({ name: "IGST", code: "IGST", rate: parsedRate, amount: igst });
      }
    }

    const totalTax = cgst + sgst + igst;
    const totalAmount = round2(parsedAmount + totalTax);

    return {
      taxType: "GST",
      cgst,
      sgst,
      igst,
      totalTax,
      totalAmount,
      taxLines
    };
  }

  getInvoiceFields() {
    return ["GSTIN", "placeOfSupply", "HSN/SAC"];
  }

  getReports() {
    return ["GSTR1", "GSTR3B", "TDS"];
  }

  getCountryMetadata() {
    return {
      country: "IN",
      name: "India",
      currency: "INR"
    };
  }

  getTaxType() {
    return "GST";
  }

  getTaxLiabilityAccount() {
    return "GST Payable";
  }
}

module.exports = IndiaPackService;
