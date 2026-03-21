const Invoice = require("../models/Invoice");
const Expense = require("../models/Expense");

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
    const expenseFilter = {};

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
    return res.status(500).json({ message: "server error" });
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
    return res.status(500).json({ message: "server error" });
  }
}

// GST Export helpers (reuse parseYMDToUTCDate)\n\nfunction formatDateYMD(date) {\n  if (!date || !(date instanceof Date)) return '';\n  const year = date.getUTCFullYear();\n  const month = String(date.getUTCMonth() + 1).padStart(2, '0');\n  const day = String(date.getUTCDate()).padStart(2, '0');\n  return `${year}-${month}-${day}`;\n}\n\nfunction round2(num) {\n  return Number.isFinite(Number(num)) ? Number(Number(num).toFixed(2)) : 0;\n}\n\nasync function buildInvoicesData(filter) {\n  const invoices = await Invoice.find(filter)\n    .populate('customer', 'name')\n    .sort({ createdAt: -1 })\n    .lean();\n\n  let totalSales = 0;\n  let totalTax = 0;\n\n  const processedInvoices = invoices.map(inv => {\n    const taxableValue = round2(inv.amount);\n    const cgst = round2(inv.cgst);\n    const sgst = round2(inv.sgst);\n    const igst = round2(inv.igst);\n    const totalAmount = round2(inv.totalAmount);\n\n    totalSales += taxableValue;\n    totalTax += cgst + sgst + igst;\n\n    return {\n      invoiceNumber: inv.invoiceNumber || inv._id.toString(),\n      date: formatDateYMD(inv.createdAt),\n      customerName: inv.customer?.name || 'Unknown',\n      gstType: inv.gstType || '',\n      taxableValue,\n      cgst,\n      sgst,\n      igst,\n      totalAmount\n    };\n  });\n\n  return {\n    invoices: processedInvoices,\n    totalSales: round2(totalSales),\n    totalTax: round2(totalTax)\n  };\n}\n\n// GSTR-1 JSON\nasync function exportGstr1(req, res) {\n  try {\n    const { financialYearId, startDate, endDate } = req.query ?? {};\n\n    const filter = {};\n    if (financialYearId) {\n      filter.financialYearId = financialYearId;\n    } else if (startDate || endDate) {\n      const createdAtFilter = {};\n      const start = parseYMDToUTCDate(startDate);\n      const end = parseYMDToUTCDate(endDate);\n      if (start) createdAtFilter.$gte = start;\n      if (end) {\n        createdAtFilter.$lte = new Date(\n          Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999)\n        );\n      }\n      filter.createdAt = createdAtFilter;\n    }\n\n    const data = await buildInvoicesData(filter);\n    res.json(data);\n  } catch (err) {\n    console.error(err);\n    res.status(500).json({ message: 'Server error' });\n  }\n}\n\n// GSTR-3B JSON\nasync function exportGstr3b(req, res) {\n  try {\n    const filter = {}; // same filter logic as above\n    if (req.query.financialYearId) {\n      filter.financialYearId = req.query.financialYearId;\n    } else if (req.query.startDate || req.query.endDate) {\n      const createdAtFilter = {};\n      const start = parseYMDToUTCDate(req.query.startDate);\n      const end = parseYMDToUTCDate(req.query.endDate);\n      if (start) createdAtFilter.$gte = start;\n      if (end) {\n        createdAtFilter.$lte = new Date(\n          Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999)\n        );\n      }\n      filter.createdAt = createdAtFilter;\n    }\n\n    const { totalTax: outwardTax } = await buildInvoicesData(filter);\n    const inwardTax = 0;\n    const netPayable = round2(outwardTax - inwardTax);\n\n    res.json({\n      outwardTax: round2(outwardTax),\n      inwardTax,\n      netPayable\n    });\n  } catch (err) {\n    console.error(err);\n    res.status(500).json({ message: 'Server error' });\n  }\n}\n\n// CSV helpers\nfunction jsonToCsv(jsonData, headers) {\n  const rows = [headers.join(',')];\n  jsonData.forEach(row => {\n    rows.push(headers.map(h => JSON.stringify(row[h] || '').slice(1, -1).replace(/\\n/g, ' ')).join(','));\n  });\n  return rows.join('\\n');\n}\n\n// GSTR-1 CSV\nasync function exportGstr1Csv(req, res) {\n  try {\n    const data = await buildInvoicesData(req.query);\n    const headers = ['invoiceNumber', 'date', 'customerName', 'gstType', 'taxableValue', 'cgst', 'sgst', 'igst', 'totalAmount'];\n    const csv = jsonToCsv(data.invoices, headers);\n    res.set({\n      'Content-Type': 'text/csv',\n      'Content-Disposition': 'attachment; filename=\\"GSTR1.csv\\"' \n    });\n    res.send(csv);\n  } catch (err) {\n    console.error(err);\n    res.status(500).json({ message: 'Server error' });\n  }\n}\n\n// GSTR-3B CSV\nasync function exportGstr3bCsv(req, res) {\n  try {\n    const { totalTax: outwardTax } = await buildInvoicesData(req.query);\n    const inwardTax = 0;\n    const netPayable = round2(outwardTax - inwardTax);\n    const data = [{ outwardTax: round2(outwardTax), inwardTax, netPayable }];\n    const headers = ['outwardTax', 'inwardTax', 'netPayable'];\n    const csv = jsonToCsv(data, headers);\n    res.set({\n      'Content-Type': 'text/csv',\n      'Content-Disposition': 'attachment; filename=\\"GSTR3B.csv\\"' \n    });\n    res.send(csv);\n  } catch (err) {\n    console.error(err);\n    res.status(500).json({ message: 'Server error' });\n  }\n}\n\nmodule.exports = { getReports, getGstReport, exportGstr1, exportGstr3b, exportGstr1Csv, exportGstr3bCsv };

