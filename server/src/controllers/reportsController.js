const Invoice = require("../models/Invoice");
const Expense = require("../models/Expense");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

function parseYMDToUTCDate(ymd) {
  if (typeof ymd !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;

  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1; // 0-based
  const day = Number(m[3]);
  const t = Date.UTC(year, monthIndex, day, 0, 0, 0, 0);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function getReports(_req, res) {
  try {
    const { startDate, endDate } = _req.query ?? {};

    const invoiceFilter = {};
    const expenseFilter = { status: "approved" };

    const start = parseYMDToUTCDate(startDate);
    const end = parseYMDToUTCDate(endDate);

    if (start || end) {
      const createdAtFilter = {};
      if (start) createdAtFilter.$gte = start;
      if (end) {
        createdAtFilter.$lte = new Date(
          Date.UTC(
            end.getUTCFullYear(),
            end.getUTCMonth(),
            end.getUTCDate(),
            23,
            59,
            59,
            999,
          ),
        );
      }
      invoiceFilter.createdAt = createdAtFilter;
      expenseFilter.createdAt = createdAtFilter;
    }

    const [invoices, expenses] = await Promise.all([
      Invoice.find(invoiceFilter)
        .sort({ createdAt: -1 })
        .populate("customer")
        .lean(),
      Expense.find(expenseFilter).sort({ createdAt: -1 }).lean(),
    ]);

    const revenue = invoices.reduce(
      (sum, i) => sum + (Number.isFinite(i.totalAmount) ? i.totalAmount : 0),
      0,
    );
    const expensesTotal = expenses.reduce(
      (sum, e) => sum + (Number.isFinite(e.amount) ? e.amount : 0),
      0,
    );

    return res.json({
      revenue,
      expenses: expensesTotal,
      profit: revenue - expensesTotal,
      totalInvoices: invoices.length,
      totalExpenses: expenses.length,
      invoices,
      expensesList: expenses,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "REPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function getGstReport(req, res) {
  try {
    const { startDate, endDate } = req.query ?? {};

    const invoiceFilter = {};

    const start = parseYMDToUTCDate(startDate);
    const end = parseYMDToUTCDate(endDate);

    if (start || end) {
      const createdAtFilter = {};
      if (start) createdAtFilter.$gte = start;
      if (end) {
        createdAtFilter.$lte = new Date(
          Date.UTC(
            end.getUTCFullYear(),
            end.getUTCMonth(),
            end.getUTCDate(),
            23,
            59,
            59,
            999,
          ),
        );
      }
      invoiceFilter.createdAt = createdAtFilter;
    }

    if (req.activeYear?._id) {
      invoiceFilter.financialYearId = req.activeYear._id;
    }

    const invoices = await Invoice.find(invoiceFilter)
      .sort({ createdAt: -1 })
      .populate("customer")
      .lean();

    let totalSales = 0;
    let totalTax = 0;

    for (const inv of invoices) {
      const amount = Number(inv.amount);
      const cgst  = Number.isFinite(Number(inv.cgst))  ? Number(inv.cgst)  : 0;
      const sgst  = Number.isFinite(Number(inv.sgst))  ? Number(inv.sgst)  : 0;
      const igst  = Number.isFinite(Number(inv.igst))  ? Number(inv.igst)  : 0;

      if (Number.isFinite(amount)) totalSales += amount;
      totalTax += cgst + sgst + igst;
    }

    const outwardTax  = totalTax;
    const inwardTax   = 0;          // Purchase-side ITC not yet implemented
    const netPayable  = outwardTax - inwardTax;

    return res.json({
      gstr1: {
        totalSales,
        totalTax,
        invoices: invoices.map((inv) => ({
          _id:          inv._id,
          customer:     inv.customer,
          amount:       inv.amount,
          gstRate:      inv.gstRate ?? 0,
          gstType:      inv.gstType,
          cgst:         inv.cgst,
          sgst:         inv.sgst,
          igst:         inv.igst,
          totalAmount:  inv.totalAmount,
          status:       inv.status,
          createdAt:    inv.createdAt,
        })),
      },
      gstr3b: {
        outwardTax,
        inwardTax,
        netPayable,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "GST_REPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// GST Export helpers (reuse parseYMDToUTCDate)
function formatDateYMD(date) {
  if (!date || !(date instanceof Date)) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function round2(num) {
  const n = Number(num);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function buildGstFilter(query = {}) {
  const { financialYearId, startDate, endDate } = query;
  const filter = {};

  if (financialYearId) {
    filter.financialYearId = financialYearId;
    return filter;
  }

  if (startDate || endDate) {
    const createdAtFilter = {};
    const start = parseYMDToUTCDate(startDate);
    const end = parseYMDToUTCDate(endDate);
    if (start) createdAtFilter.$gte = start;
    if (end) {
      createdAtFilter.$lte = new Date(
        Date.UTC(
          end.getUTCFullYear(),
          end.getUTCMonth(),
          end.getUTCDate(),
          23,
          59,
          59,
          999,
        ),
      );
    }
    filter.createdAt = createdAtFilter;
  }

  return filter;
}

async function buildInvoicesData(filter) {
  const invoices = await Invoice.find(filter)
    .populate("customer", "name")
    .sort({ createdAt: -1 })
    .lean();

  let totalSales = 0;
  let totalTax = 0;

  const processedInvoices = invoices.map((inv) => {
    const taxableValue = round2(inv.amount);
    const cgst = round2(inv.cgst);
    const sgst = round2(inv.sgst);
    const igst = round2(inv.igst);
    const totalAmount = round2(inv.totalAmount);

    totalSales += taxableValue;
    totalTax += cgst + sgst + igst;

    return {
      invoiceNumber: inv.invoiceNumber || inv._id.toString(),
      date: formatDateYMD(inv.createdAt),
      customerName: inv.customer?.name || "Unknown",
      gstType: inv.gstType || "",
      taxableValue,
      cgst,
      sgst,
      igst,
      totalAmount,
    };
  });

  return {
    invoices: processedInvoices,
    totalSales: round2(totalSales),
    totalTax: round2(totalTax),
  };
}

// GSTR-1 JSON
async function exportGstr1(req, res) {
  try {
    const filter = buildGstFilter(req.query ?? {});
    const data = await buildInvoicesData(filter);
    res.json(data);
  } catch (err) {
    console.error(err);
    return sendStructuredError(res, {
      code: "GST_EXPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// GSTR-3B JSON
async function exportGstr3b(req, res) {
  try {
    const filter = buildGstFilter(req.query ?? {});
    const { totalTax: outwardTax } = await buildInvoicesData(filter);
    const inwardTax = 0;
    const netPayable = round2(outwardTax - inwardTax);

    res.json({
      outwardTax: round2(outwardTax),
      inwardTax,
      netPayable,
    });
  } catch (err) {
    console.error(err);
    return sendStructuredError(res, {
      code: "GST_EXPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// CSV helpers
function jsonToCsv(jsonData, headers) {
  const rows = [headers.join(",")];
  jsonData.forEach((row) => {
    rows.push(
      headers
        .map((h) => JSON.stringify(row[h] || "").slice(1, -1).replace(/\n/g, " "))
        .join(","),
    );
  });
  return rows.join("\n");
}

// GSTR-1 CSV
async function exportGstr1Csv(req, res) {
  try {
    const filter = buildGstFilter(req.query ?? {});
    const data = await buildInvoicesData(filter);
    const headers = [
      "invoiceNumber",
      "date",
      "customerName",
      "gstType",
      "taxableValue",
      "cgst",
      "sgst",
      "igst",
      "totalAmount",
    ];
    const csv = jsonToCsv(data.invoices, headers);
    res.set({
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="GSTR1.csv"',
    });
    res.send(csv);
  } catch (err) {
    console.error(err);
    return sendStructuredError(res, {
      code: "GST_EXPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// GSTR-3B CSV
async function exportGstr3bCsv(req, res) {
  try {
    const filter = buildGstFilter(req.query ?? {});
    const { totalTax: outwardTax } = await buildInvoicesData(filter);
    const inwardTax = 0;
    const netPayable = round2(outwardTax - inwardTax);
    const data = [{ outwardTax: round2(outwardTax), inwardTax, netPayable }];
    const headers = ["outwardTax", "inwardTax", "netPayable"];
    const csv = jsonToCsv(data, headers);
    res.set({
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="GSTR3B.csv"',
    });
    res.send(csv);
  } catch (err) {
    console.error(err);
    return sendStructuredError(res, {
      code: "GST_EXPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

module.exports = {
  getReports,
  getGstReport,
  exportGstr1,
  exportGstr3b,
  exportGstr1Csv,
  exportGstr3bCsv,
};

