class TaxResolver {
  resolve(invoice, entity) {
    throw new Error("resolve must be implemented");
  }
}
module.exports = TaxResolver;
