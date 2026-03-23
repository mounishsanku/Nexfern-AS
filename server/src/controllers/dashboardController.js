const { buildAccountMap, resolveFilter, round } = require("./reportController");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

/**
 * GET /api/dashboard — summary KPIs from VoucherEntry (same basis as /api/dashboard/summary).
 */
exports.getDashboard = async (req, res) => {
  try {
    const { voucherIds, financialYearId } = await resolveFilter(req.query);
    const map = await buildAccountMap(voucherIds, financialYearId);

    let revenue = 0;
    let expenses = 0;

    for (const row of map.values()) {
      if (row.type === "revenue") revenue += row.credit - row.debit;
      if (row.type === "expense") expenses += row.debit - row.credit;
    }

    const profit = revenue - expenses;

    res.json({
      revenue: round(revenue),
      expenses: round(expenses),
      profit: round(profit),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "DASHBOARD_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
};
