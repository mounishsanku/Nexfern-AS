class ReportProvider {
  generate(type, filters) {
    throw new Error("generate must be implemented");
  }
}
module.exports = ReportProvider;
