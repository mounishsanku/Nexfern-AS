const ReportProvider = require("../interfaces/ReportProvider");

class UaeReportProvider extends ReportProvider {
  generate(type, filters) {
    // Skeleton for UAE VAT returns
    return {
      type,
      status: "generated",
      data: []
    };
  }
}

module.exports = UaeReportProvider;
