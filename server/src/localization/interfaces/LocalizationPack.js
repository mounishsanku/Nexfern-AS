class LocalizationPack {
  validateInvoice(invoice, entity) {
    throw new Error("validateInvoice must be implemented");
  }

  calculateTax(invoice, entity) {
    throw new Error("calculateTax must be implemented");
  }

  getInvoiceFields() {
    throw new Error("getInvoiceFields must be implemented");
  }

  getReports() {
    throw new Error("getReports must be implemented");
  }

  getCountryMetadata() {
    throw new Error("getCountryMetadata must be implemented");
  }

  getTaxType() {
    throw new Error("getTaxType must be implemented");
  }
}

module.exports = LocalizationPack;
