const { round2 } = require("../utils/round");

function resolveTaxes({ invoiceData, taxProfile }) {
  const subtotal = Number(invoiceData.amount) || 0;
  const taxLines = [];
  let totalTax = 0;

  if (taxProfile && Array.isArray(taxProfile.taxRules)) {
    for (const rule of taxProfile.taxRules) {
      if (!rule.isActive) continue;
      
      // Foundation: Basic deterministic rule execution
      const lineAmount = round2(subtotal * (rule.rate / 100));
      taxLines.push({
        code: rule.code,
        name: rule.name,
        rate: rule.rate,
        amount: lineAmount,
        taxType: rule.taxType
      });
      totalTax += lineAmount;
    }
  }

  return {
    taxLines,
    totals: {
      subtotal,
      totalTax: round2(totalTax),
      grandTotal: round2(subtotal + totalTax)
    }
  };
}

module.exports = { resolveTaxes };
