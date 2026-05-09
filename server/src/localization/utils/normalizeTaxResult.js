/**
 * Normalizes a localization pack's taxResult into the legacy GST structure
 * required for backward compatibility.
 * 
 * NEVER mutates the original object. Returns a fresh normalized object.
 */
function normalizeTaxResult(taxResult) {
  if (!taxResult || typeof taxResult !== "object") {
    return {
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalTax: 0,
      taxLines: []
    };
  }

  const normalized = {
    cgst: 0,
    sgst: 0,
    igst: 0,
    totalTax: 0,
    taxLines: Array.isArray(taxResult.taxLines) ? taxResult.taxLines.map(t => ({...t})) : []
  };

  if (taxResult.taxType === "GST") {
    normalized.cgst = Number(taxResult.cgst) || 0;
    normalized.sgst = Number(taxResult.sgst) || 0;
    normalized.igst = Number(taxResult.igst) || 0;
    normalized.totalTax = normalized.cgst + normalized.sgst + normalized.igst;
  } else {
    // For other taxes, totalTax is sum of tax lines
    normalized.totalTax = normalized.taxLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  }

  return normalized;
}

module.exports = { normalizeTaxResult };
