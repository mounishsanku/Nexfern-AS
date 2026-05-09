const ReportProvider = require("../interfaces/ReportProvider");
const { buildGstFilter, buildInvoicesData } = require("../../controllers/reportsController");

function round2(num) {
  const n = Number(num);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

class IndiaReportProvider extends ReportProvider {
  async generate(type, filters) {
    const filter = buildGstFilter(filters || {});
    
    if (type === "GSTR1") {
      const data = await buildInvoicesData(filter);
      return {
        type,
        status: "generated",
        data: data.invoices,
        totals: {
          totalSales: data.totalSales,
          totalTax: data.totalTax,
        }
      };
    } else if (type === "GSTR3B") {
      const { totalTax: outwardTax } = await buildInvoicesData(filter);
      const inwardTax = 0;
      const netPayable = round2(outwardTax - inwardTax);
      return {
        type,
        status: "generated",
        data: [{ outwardTax: round2(outwardTax), inwardTax, netPayable }]
      };
    }
    
    return {
      type,
      status: "unsupported",
      data: []
    };
  }
}

module.exports = IndiaReportProvider;
