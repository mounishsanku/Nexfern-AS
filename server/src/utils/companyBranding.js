/**
 * Company identity for PDFs and exports (override via environment).
 */

function getCompanyBranding() {
  const addr = process.env.COMPANY_ADDRESS || "";
  const lines = addr
    .split(/[|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    name: process.env.COMPANY_NAME || "Nexfern FinanceOS",
    tagline: process.env.COMPANY_TAGLINE || "",
    addressLines: lines.length ? lines : ["India"],
    logoPath: process.env.COMPANY_LOGO_PATH || null,
    gstin: process.env.COMPANY_GSTIN || "",
    email: process.env.COMPANY_EMAIL || "",
    phone: process.env.COMPANY_PHONE || "",
  };
}

module.exports = { getCompanyBranding };
