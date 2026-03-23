const VoucherEntry   = require("../models/VoucherEntry");
const Voucher        = require("../models/Voucher");
const Account        = require("../models/Account");
const FinancialYear  = require("../models/FinancialYear");
const OpeningBalance = require("../models/OpeningBalance");
const Invoice        = require("../models/Invoice");
const RevenueSchedule = require("../models/RevenueSchedule");
const Project = require("../models/Project");
const Batch = require("../models/Batch");
const Event = require("../models/Event");
const Expense = require("../models/Expense");
const BankAccount = require("../models/BankAccount");
const {
  normalizeDepartment,
  defaultDepartmentFromRevenueType,
} = require("../utils/department");
const { sendCsv } = require("../utils/csvExport");
const { signedOpeningAmount } = require("../utils/openingBalanceUtils");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

// ---------------------------------------------------------------------------
// Resolve query params → { voucherIds, financialYearId }
// Priority: explicit financialYearId > startDate/endDate > active FY default.
// ---------------------------------------------------------------------------

async function resolveFilter(query) {
  const { financialYearId, startDate, endDate, department } = query ?? {};
  const normalizedDepartment = normalizeDepartment(department);

  let resolvedFYId = null;
  const voucherFilter = {};

  if (financialYearId) {
    resolvedFYId = financialYearId;
    voucherFilter.financialYearId = financialYearId;
  } else if (startDate || endDate) {
    voucherFilter.date = {};
    if (startDate) voucherFilter.date.$gte = new Date(startDate);
    if (endDate)   voucherFilter.date.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    // No FY id when filtering by date range — opening balances won't apply
  } else {
    const activeYear = await FinancialYear.findOne({ isClosed: false })
      .sort({ startDate: -1 })
      .lean();
    if (activeYear) {
      resolvedFYId = String(activeYear._id);
      voucherFilter.financialYearId = activeYear._id;
    }
  }

  let voucherIds = null;
  if (Object.keys(voucherFilter).length > 0 || normalizedDepartment) {
    let vouchers = await Voucher.find(voucherFilter)
      .select("_id referenceType referenceId department")
      .lean();

    // Exclude vouchers that reference non-approved expenses (pending/rejected must not affect reports)
    const expenseRefIds = vouchers
      .filter((v) => v.referenceType === "expense" && v.referenceId)
      .map((v) => String(v.referenceId));
    if (expenseRefIds.length) {
      const nonApproved = await Expense.find({
        _id: { $in: expenseRefIds },
        status: { $ne: "approved" },
      })
        .select("_id")
        .lean();
      const nonApprovedSet = new Set(nonApproved.map((e) => String(e._id)));
      if (nonApprovedSet.size) {
        const excludeVoucherIds = new Set(
          vouchers
            .filter((v) => v.referenceType === "expense" && v.referenceId && nonApprovedSet.has(String(v.referenceId)))
            .map((v) => String(v._id)),
        );
        vouchers = vouchers.filter((v) => !excludeVoucherIds.has(String(v._id)));
      }
    }

    if (normalizedDepartment) {
      const voucherDepartmentMap = await buildVoucherDepartmentMap(vouchers);
      voucherIds = vouchers
        .filter((v) => (voucherDepartmentMap.get(String(v._id)) || "tech") === normalizedDepartment)
        .map((v) => v._id);
    } else {
      voucherIds = vouchers.map((v) => v._id);
    }
  }

  return { voucherIds, financialYearId: resolvedFYId };
}

async function buildVoucherDepartmentMap(vouchers) {
  const map = new Map();
  if (!Array.isArray(vouchers) || vouchers.length === 0) return map;

  const invoiceRefIds = vouchers
    .filter((v) => v.referenceType === "invoice" && v.referenceId)
    .map((v) => String(v.referenceId));
  const scheduleRefIds = vouchers
    .filter((v) => v.referenceType === "revenue_schedule" && v.referenceId)
    .map((v) => String(v.referenceId));
  const expenseRefIds = vouchers
    .filter((v) => v.referenceType === "expense" && v.referenceId)
    .map((v) => String(v.referenceId));

  const [invoiceDocs, schedules, expenseRows] = await Promise.all([
    invoiceRefIds.length
      ? Invoice.find({ _id: { $in: invoiceRefIds } }).select("_id department revenueType").lean()
      : [],
    scheduleRefIds.length
      ? RevenueSchedule.find({ _id: { $in: scheduleRefIds } }).select("_id invoiceId").lean()
      : [],
    expenseRefIds.length
      ? Expense.find({ _id: { $in: expenseRefIds } }).select("_id department status").lean()
      : [],
  ]);

  const expenseDocs = [];
  for (const e of expenseRows) {
    if (e.status === "approved") {
      expenseDocs.push(e);
    } else {
      const err = new Error(
        `Voucher references expense with status "${e.status}" (not approved). Pending/rejected expenses must not affect reports.`,
      );
      err.code = "NON_APPROVED_EXPENSE_VOUCHERS";
      throw err;
    }
  }

  const scheduleToInvoice = new Map(schedules.map((s) => [String(s._id), String(s.invoiceId)]));
  const scheduleInvoiceIds = [...new Set(schedules.map((s) => String(s.invoiceId)))];
  const scheduleInvoices = scheduleInvoiceIds.length
    ? await Invoice.find({ _id: { $in: scheduleInvoiceIds } }).select("_id department revenueType").lean()
    : [];

  const invoiceDeptMap = new Map();
  for (const i of [...invoiceDocs, ...scheduleInvoices]) {
    invoiceDeptMap.set(
      String(i._id),
      normalizeDepartment(i.department) || defaultDepartmentFromRevenueType(i.revenueType)
    );
  }
  const expenseDeptMap = new Map(
    expenseDocs.map((e) => [String(e._id), normalizeDepartment(e.department) || "tech"])
  );

  for (const v of vouchers) {
    let resolved = normalizeDepartment(v.department);
    if (!resolved && v.referenceType === "invoice" && v.referenceId) {
      resolved = invoiceDeptMap.get(String(v.referenceId)) || null;
    }
    if (!resolved && v.referenceType === "revenue_schedule" && v.referenceId) {
      const invoiceId = scheduleToInvoice.get(String(v.referenceId));
      resolved = invoiceId ? invoiceDeptMap.get(invoiceId) : null;
    }
    if (!resolved && v.referenceType === "expense" && v.referenceId) {
      resolved = expenseDeptMap.get(String(v.referenceId)) || null;
    }
    map.set(String(v._id), resolved || "tech");
  }
  return map;
}

// ---------------------------------------------------------------------------
// Load opening balances for a FY → Map<accountId string, amount>
// ---------------------------------------------------------------------------

async function loadOpeningBalances(financialYearId, session = null) {
  if (!financialYearId) return new Map();
  let q = OpeningBalance.find({ financialYearId });
  if (session) q = q.session(session);
  const obs = await q.lean();
  return new Map(obs.map((ob) => [String(ob.accountId), signedOpeningAmount(ob)]));
}

// ---------------------------------------------------------------------------
// Build account map with opening balances applied
// Returns Map<accountId string, { account, type, openingBalance, debit, credit, balance }>
// ---------------------------------------------------------------------------

async function buildAccountMap(voucherIds, financialYearId, options = {}) {
  const session = options.session ?? null;
  const entryFilter = voucherIds ? { voucherId: { $in: voucherIds } } : {};

  let veQuery = VoucherEntry.find(entryFilter).populate({ path: "accountId", select: "name type" });
  if (session) veQuery = veQuery.session(session);

  const [entries, obMap] = await Promise.all([
    veQuery.lean(),
    loadOpeningBalances(financialYearId, session),
  ]);

  const map = new Map();

  // Seed map with accounts that have opening balances (even if no movements this year)
  for (const [key, amount] of obMap) {
    if (!map.has(key)) {
      // We need name/type — fetch lazily below; store placeholder for now
      map.set(key, { _needsPopulate: true, openingBalance: amount, debit: 0, credit: 0 });
    }
  }

  for (const e of entries) {
    if (!e.accountId) continue;
    const key  = String(e.accountId._id);
    const name = e.accountId.name;
    const type = e.accountId.type;
    const ob   = obMap.get(key) ?? 0;

    if (!map.has(key)) {
      map.set(key, { account: name, type, openingBalance: ob, debit: 0, credit: 0 });
    } else {
      // Fill in name/type if this was a placeholder from obMap
      const row = map.get(key);
      row.account = name;
      row.type    = type;
      row._needsPopulate = false;
    }
    const row = map.get(key);
    row.debit  += Number(e.debit)  || 0;
    row.credit += Number(e.credit) || 0;
  }

  // Populate any remaining placeholders (accounts with OB but zero movements)
  const placeholders = [...map.entries()].filter(([, v]) => v._needsPopulate);
  if (placeholders.length > 0) {
    const ids = placeholders.map(([k]) => k);
    let aq = Account.find({ _id: { $in: ids } });
    if (session) aq = aq.session(session);
    const accounts = await aq.lean();
    for (const a of accounts) {
      const row = map.get(String(a._id));
      if (row) { row.account = a.name; row.type = a.type; row._needsPopulate = false; }
    }
    // Remove any still-unresolved placeholders (orphaned OB rows)
    for (const [k, v] of map) {
      if (v._needsPopulate) map.delete(k);
    }
  }

  // Compute final balance: openingBalance + net movement
  for (const row of map.values()) {
    row.balance = round(row.openingBalance + row.debit - row.credit);
  }

  return map;
}

// ---------------------------------------------------------------------------
// GET /api/reports/trial-balance
// ---------------------------------------------------------------------------

async function getTrialBalance(req, res) {
  try {
    const { voucherIds, financialYearId } = await resolveFilter(req.query);
    const map = await buildAccountMap(voucherIds, financialYearId);

    let totalDebit = 0, totalCredit = 0;

    const accounts = Array.from(map.values())
      .sort((a, b) => a.account.localeCompare(b.account))
      .map((row) => {
        totalDebit  += row.debit;
        totalCredit += row.credit;
        return {
          account:        row.account,
          type:           row.type,
          openingBalance: round(row.openingBalance),
          debit:          round(row.debit),
          credit:         round(row.credit),
          balance:        round(row.balance),
        };
      });

    return res.json({
      accounts,
      totals: { totalDebit: round(totalDebit), totalCredit: round(totalCredit) },
    });
  } catch (err) {
    console.error("getTrialBalance error:", err);
    if (err?.code === "NON_APPROVED_EXPENSE_VOUCHERS") {
      return res.status(400).json({
        message: err.message || "Invalid expense-linked vouchers in reporting scope",
        code: "NON_APPROVED_EXPENSE_VOUCHERS",
      });
    }
    return sendStructuredError(res, {
      code: "TRIAL_BALANCE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
      details: err?.message ? { reason: String(err.message) } : undefined,
    });
  }
}

async function exportTrialBalanceCsv(req, res) {
  try {
    const { voucherIds, financialYearId } = await resolveFilter(req.query);
    const map = await buildAccountMap(voucherIds, financialYearId);

    let totalDebit = 0;
    let totalCredit = 0;
    const rows = [["Account", "Type", "Opening Balance", "Debit", "Credit", "Balance"]];

    const accounts = Array.from(map.values())
      .sort((a, b) => a.account.localeCompare(b.account));

    for (const row of accounts) {
      totalDebit += row.debit;
      totalCredit += row.credit;
      rows.push([
        row.account,
        row.type,
        String(round(row.openingBalance)),
        String(round(row.debit)),
        String(round(row.credit)),
        String(round(row.balance)),
      ]);
    }

    rows.push([
      "Total",
      "",
      "",
      String(round(totalDebit)),
      String(round(totalCredit)),
      String(round(totalDebit - totalCredit)),
    ]);

    sendCsv(res, "trial-balance.csv", rows);
  } catch (err) {
    console.error("exportTrialBalanceCsv error:", err);
    if (err?.code === "NON_APPROVED_EXPENSE_VOUCHERS") {
      return res.status(400).json({
        message: err.message || "Invalid expense-linked vouchers in reporting scope",
        code: "NON_APPROVED_EXPENSE_VOUCHERS",
      });
    }
    return sendStructuredError(res, {
      code: "TRIAL_BALANCE_EXPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
      details: err?.message ? { reason: String(err.message) } : undefined,
    });
  }
}

// ---------------------------------------------------------------------------
// GET /api/reports/ledger/:account
// ---------------------------------------------------------------------------

async function getLedgerByAccount(req, res) {
  try {
    const param = decodeURIComponent(req.params.account ?? "").trim();
    if (!param) return res.status(400).json({ message: "account name is required" });

    let accountDoc = await Account.findOne({ name: param }).lean();
    if (!accountDoc) accountDoc = await Account.findById(param).lean().catch(() => null);
    if (!accountDoc) return res.status(404).json({ message: `Account "${param}" not found` });

    const { voucherIds, financialYearId } = await resolveFilter(req.query);

    // Opening balance for this account in this FY
    let openingBalance = 0;
    if (financialYearId) {
      const ob = await OpeningBalance.findOne({
        accountId: accountDoc._id,
        financialYearId,
      }).lean();
      openingBalance = signedOpeningAmount(ob);
    }

    const entryFilter = { accountId: accountDoc._id };
    if (voucherIds) entryFilter.voucherId = { $in: voucherIds };

    const entries = await VoucherEntry.find(entryFilter)
      .populate({ path: "voucherId", select: "voucherNumber date narration type" })
      .sort({ "voucherId.date": 1, _id: 1 })
      .lean();

    let runningBalance = openingBalance;
    let totalDebit = 0, totalCredit = 0;

    const rows = entries.map((e) => {
      const debit  = Number(e.debit)  || 0;
      const credit = Number(e.credit) || 0;
      runningBalance += debit - credit;
      totalDebit     += debit;
      totalCredit    += credit;
      return {
        _id:           e._id,
        date:          e.voucherId?.date          ?? null,
        voucherNumber: e.voucherId?.voucherNumber ?? "-",
        voucherType:   e.voucherId?.type          ?? "-",
        narration:     e.voucherId?.narration     ?? "-",
        debit:         round(debit),
        credit:        round(credit),
        balance:       round(runningBalance),
      };
    });

    return res.json({
      account:        accountDoc.name,
      openingBalance: round(openingBalance),
      totalDebit:     round(totalDebit),
      totalCredit:    round(totalCredit),
      balance:        round(openingBalance + totalDebit - totalCredit),
      entries:        rows,
    });
  } catch (err) {
    console.error("getLedgerByAccount error:", err);
    return sendStructuredError(res, {
      code: "REPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function exportLedgerCsv(req, res) {
  try {
    const param = decodeURIComponent(req.params.account ?? "").trim();
    if (!param) return res.status(400).json({ message: "account name is required" });

    let accountDoc = await Account.findOne({ name: param }).lean();
    if (!accountDoc) accountDoc = await Account.findById(param).lean().catch(() => null);
    if (!accountDoc) return res.status(404).json({ message: `Account "${param}" not found` });

    const { voucherIds, financialYearId } = await resolveFilter(req.query);

    let openingBalance = 0;
    if (financialYearId) {
      const ob = await OpeningBalance.findOne({
        accountId: accountDoc._id,
        financialYearId,
      }).lean();
      openingBalance = signedOpeningAmount(ob);
    }

    const entryFilter = { accountId: accountDoc._id };
    if (voucherIds) entryFilter.voucherId = { $in: voucherIds };

    const entries = await VoucherEntry.find(entryFilter)
      .populate({ path: "voucherId", select: "voucherNumber date narration type" })
      .sort({ "voucherId.date": 1, _id: 1 })
      .lean();

    let runningBalance = openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;

    const rows = [
      ["Date", "Voucher", "Voucher Type", "Narration", "Debit", "Credit", "Balance"],
    ];

    for (const e of entries) {
      const debit = Number(e.debit) || 0;
      const credit = Number(e.credit) || 0;
      runningBalance += debit - credit;
      totalDebit += debit;
      totalCredit += credit;
      const d = e.voucherId?.date ? new Date(e.voucherId.date) : null;
      rows.push([
        d ? d.toISOString().slice(0, 10) : "",
        e.voucherId?.voucherNumber ?? "",
        e.voucherId?.type ?? "",
        e.voucherId?.narration ?? "",
        String(round(debit)),
        String(round(credit)),
        String(round(runningBalance)),
      ]);
    }

    rows.push([
      "TOTAL",
      "",
      "",
      "",
      String(round(totalDebit)),
      String(round(totalCredit)),
      String(round(runningBalance)),
    ]);

    const safe = String(accountDoc.name).replace(/[^\w.\-]+/g, "_");
    sendCsv(res, `ledger-${safe}.csv`, rows);
  } catch (err) {
    console.error("exportLedgerCsv error:", err);
    return sendStructuredError(res, {
      code: "REPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ---------------------------------------------------------------------------
// GET /api/reports/profit-loss
// ---------------------------------------------------------------------------

async function getProfitLoss(req, res) {
  try {
    const { voucherIds, financialYearId } = await resolveFilter(req.query);
    const map = await buildAccountMap(voucherIds, financialYearId);

    let revenue = 0, expenses = 0;
    for (const row of map.values()) {
      // P&L accounts: opening balance is always 0 (reset each year)
      if (row.type === "revenue") revenue  += row.credit - row.debit;
      if (row.type === "expense") expenses += row.debit  - row.credit;
    }

    return res.json({
      revenue:  round(revenue),
      expenses: round(expenses),
      profit:   round(revenue - expenses),
    });
  } catch (err) {
    console.error("getProfitLoss error:", err);
    return sendStructuredError(res, {
      code: "REPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ---------------------------------------------------------------------------
// GET /api/reports/revenue-split
// Group revenue by invoice.revenueType using voucher links
// ---------------------------------------------------------------------------

async function computeRevenueSplit(voucherIds) {
  const split = {
    project: 0,
    academy: 0,
    event: 0,
    projectWise: [],
    batchWise: [],
    eventWise: [],
  };
  if (!voucherIds || voucherIds.length === 0) return split;

  const [revenueAccounts, vouchers] = await Promise.all([
    Account.find({ type: "revenue" }).select("_id").lean(),
    Voucher.find({ _id: { $in: voucherIds } })
      .select("_id referenceType referenceId")
      .lean(),
  ]);
  if (!revenueAccounts.length || !vouchers.length) return split;

  const revenueSet = new Set(revenueAccounts.map((a) => String(a._id)));

  const invoiceRefIds = vouchers
    .filter((v) => v.referenceType === "invoice" && v.referenceId)
    .map((v) => String(v.referenceId));
  const scheduleRefIds = vouchers
    .filter((v) => v.referenceType === "revenue_schedule" && v.referenceId)
    .map((v) => String(v.referenceId));

  const [invoiceDocs, schedules] = await Promise.all([
    invoiceRefIds.length
      ? Invoice.find({ _id: { $in: invoiceRefIds } }).select("_id revenueType projectId batchId eventId").lean()
      : [],
    scheduleRefIds.length
      ? RevenueSchedule.find({ _id: { $in: scheduleRefIds } }).select("_id invoiceId").lean()
      : [],
  ]);

  const scheduleToInvoice = new Map(schedules.map((s) => [String(s._id), String(s.invoiceId)]));
  const scheduleInvoiceIds = [...new Set(schedules.map((s) => String(s.invoiceId)))];
  const scheduleInvoices = scheduleInvoiceIds.length
    ? await Invoice.find({ _id: { $in: scheduleInvoiceIds } }).select("_id revenueType projectId batchId eventId").lean()
    : [];

  const invoiceMetaMap = new Map();
  for (const i of [...invoiceDocs, ...scheduleInvoices]) {
    invoiceMetaMap.set(String(i._id), {
      revenueType: i.revenueType || "project",
      projectId: i.projectId ? String(i.projectId) : null,
      batchId: i.batchId ? String(i.batchId) : null,
      eventId: i.eventId ? String(i.eventId) : null,
    });
  }

  const voucherMetaMap = new Map();
  for (const v of vouchers) {
    if (v.referenceType === "invoice" && v.referenceId) {
      voucherMetaMap.set(String(v._id), invoiceMetaMap.get(String(v.referenceId)) || { revenueType: "project" });
    } else if (v.referenceType === "revenue_schedule" && v.referenceId) {
      const invoiceId = scheduleToInvoice.get(String(v.referenceId));
      voucherMetaMap.set(String(v._id), (invoiceId && invoiceMetaMap.get(invoiceId)) || { revenueType: "project" });
    }
  }

  const entries = await VoucherEntry.find({ voucherId: { $in: voucherIds } })
    .select("voucherId accountId debit credit")
    .lean();

  const projectTotals = new Map();
  const batchTotals = new Map();
  const eventTotals = new Map();
  for (const e of entries) {
    if (!revenueSet.has(String(e.accountId))) continue;
    const meta = voucherMetaMap.get(String(e.voucherId)) || { revenueType: "project" };
    const t = meta.revenueType || "project";
    const amount = (Number(e.credit) || 0) - (Number(e.debit) || 0);
    if (t === "academy") {
      split.academy += amount;
      if (meta.batchId) batchTotals.set(meta.batchId, (batchTotals.get(meta.batchId) || 0) + amount);
    } else if (t === "event") {
      split.event += amount;
      if (meta.eventId) eventTotals.set(meta.eventId, (eventTotals.get(meta.eventId) || 0) + amount);
    } else {
      split.project += amount;
      if (meta.projectId) projectTotals.set(meta.projectId, (projectTotals.get(meta.projectId) || 0) + amount);
    }
  }

  const [projects, batches, events] = await Promise.all([
    projectTotals.size ? Project.find({ _id: { $in: [...projectTotals.keys()] } }).select("_id name").lean() : [],
    batchTotals.size ? Batch.find({ _id: { $in: [...batchTotals.keys()] } }).select("_id name").lean() : [],
    eventTotals.size ? Event.find({ _id: { $in: [...eventTotals.keys()] } }).select("_id name").lean() : [],
  ]);
  const projectNameMap = new Map(projects.map((p) => [String(p._id), p.name || "Project"]));
  const batchNameMap = new Map(batches.map((b) => [String(b._id), b.name || "Batch"]));
  const eventNameMap = new Map(events.map((e) => [String(e._id), e.name || "Event"]));

  split.projectWise = [...projectTotals.entries()]
    .map(([id, amount]) => ({ id, name: projectNameMap.get(id) || "Project", amount: round(amount) }))
    .sort((a, b) => b.amount - a.amount);
  split.batchWise = [...batchTotals.entries()]
    .map(([id, amount]) => ({ id, name: batchNameMap.get(id) || "Batch", amount: round(amount) }))
    .sort((a, b) => b.amount - a.amount);
  split.eventWise = [...eventTotals.entries()]
    .map(([id, amount]) => ({ id, name: eventNameMap.get(id) || "Event", amount: round(amount) }))
    .sort((a, b) => b.amount - a.amount);

  split.project = round(split.project);
  split.academy = round(split.academy);
  split.event = round(split.event);
  return split;
}

async function getRevenueSplit(req, res) {
  try {
    const { voucherIds } = await resolveFilter(req.query);
    const split = await computeRevenueSplit(voucherIds);
    return res.json(split);
  } catch (err) {
    console.error("getRevenueSplit error:", err);
    return sendStructuredError(res, {
      code: "REPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function getDepartmentSummary(req, res) {
  try {
    const { voucherIds } = await resolveFilter(req.query);
    const base = {
      academy: { revenue: 0, expenses: 0, profit: 0 },
      tech: { revenue: 0, expenses: 0, profit: 0 },
      marketing: { revenue: 0, expenses: 0, profit: 0 },
    };
    if (!voucherIds || voucherIds.length === 0) return res.json(base);

    const [vouchers, revenueAccounts, expenseAccounts, entries] = await Promise.all([
      Voucher.find({ _id: { $in: voucherIds } })
        .select("_id referenceType referenceId department")
        .lean(),
      Account.find({ type: "revenue" }).select("_id").lean(),
      Account.find({ type: "expense" }).select("_id").lean(),
      VoucherEntry.find({ voucherId: { $in: voucherIds } })
        .select("voucherId accountId debit credit")
        .lean(),
    ]);

    const voucherDepartmentMap = await buildVoucherDepartmentMap(vouchers);
    const revenueSet = new Set(revenueAccounts.map((a) => String(a._id)));
    const expenseSet = new Set(expenseAccounts.map((a) => String(a._id)));

    for (const e of entries) {
      const dep = voucherDepartmentMap.get(String(e.voucherId)) || "tech";
      const row = base[dep] || base.tech;
      const debit = Number(e.debit) || 0;
      const credit = Number(e.credit) || 0;
      if (revenueSet.has(String(e.accountId))) row.revenue += credit - debit;
      if (expenseSet.has(String(e.accountId))) row.expenses += debit - credit;
    }

    for (const dep of ["academy", "tech", "marketing"]) {
      base[dep].revenue = round(base[dep].revenue);
      base[dep].expenses = round(base[dep].expenses);
      base[dep].profit = round(base[dep].revenue - base[dep].expenses);
    }
    return res.json(base);
  } catch (err) {
    console.error("getDepartmentSummary error:", err);
    return sendStructuredError(res, {
      code: "REPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ---------------------------------------------------------------------------
// GET /api/reports/cash-flow
// ---------------------------------------------------------------------------

async function getCashFlow(req, res) {
  try {
    const { voucherIds, financialYearId } = await resolveFilter(req.query);
    const map = await buildAccountMap(voucherIds, financialYearId);

    let openingBalance = 0;
    let inflow = 0;
    let outflow = 0;
    let closingBalance = 0;
    let operatingRevenue = 0;
    let operatingExpenses = 0;

    for (const row of map.values()) {
      const name = String(row.account || "").toLowerCase();
      const isCashOrBank = row.type === "asset" && (name === "cash" || name.includes("bank"));

      if (isCashOrBank) {
        openingBalance += Number(row.openingBalance) || 0;
        inflow += Number(row.debit) || 0;
        outflow += Number(row.credit) || 0;
        closingBalance += Number(row.balance) || 0;
      }

      if (row.type === "revenue") operatingRevenue += (Number(row.credit) || 0) - (Number(row.debit) || 0);
      if (row.type === "expense") operatingExpenses += (Number(row.debit) || 0) - (Number(row.credit) || 0);
    }

    return res.json({
      openingBalance: round(openingBalance),
      inflow: round(inflow),
      outflow: round(outflow),
      closingBalance: round(closingBalance),
      operating: {
        revenue: round(operatingRevenue),
        expenses: round(operatingExpenses),
      },
    });
  } catch (err) {
    console.error("getCashFlow error:", err);
    return sendStructuredError(res, {
      code: "REPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ---------------------------------------------------------------------------
// GET /api/reports/accounting-balance-sheet
// ---------------------------------------------------------------------------

async function getBalanceSheet(req, res) {
  try {
    const { voucherIds, financialYearId } = await resolveFilter(req.query);
    const map = await buildAccountMap(voucherIds, financialYearId);

    let cash = 0, accountsReceivable = 0, otherAssets = 0;
    let gstPayable = 0, otherLiabilities = 0;
    let revenue = 0, expenses = 0, retainedEarnings = 0;

    for (const row of map.values()) {
      // balance already includes opening balance
      if (row.type === "asset") {
        if      (row.account === "Cash")                cash               = row.balance;
        else if (row.account === "Accounts Receivable") accountsReceivable = row.balance;
        else                                            otherAssets       += row.balance;
      }
      if (row.type === "liability") {
        if      (row.account === "GST Payable")         gstPayable         = -row.balance;
        else                                            otherLiabilities  += -row.balance;
      }
      if (row.type === "equity") {
        // Credit-normal equity: stored balance is (ob + dr − cr); flip for BS equation.
        retainedEarnings += -row.balance;
      }
      if (row.type === "revenue") revenue  += row.credit - row.debit;
      if (row.type === "expense") expenses += row.debit  - row.credit;
    }

    // Current year P&L adds to equity
    const currentYearProfit = round(revenue - expenses);
    const totalEquity       = round(retainedEarnings + currentYearProfit);
    const totalAssets       = round(cash + accountsReceivable + otherAssets);
    const totalLiabilities  = round(gstPayable + otherLiabilities);
    const liabilitiesPlusEquity = round(totalLiabilities + totalEquity);

    return res.json({
      assets:      { cash: round(cash), accountsReceivable: round(accountsReceivable), other: round(otherAssets), total: totalAssets },
      liabilities: { gstPayable: round(gstPayable), other: round(otherLiabilities), total: totalLiabilities },
      equity:      { retainedEarnings: round(retainedEarnings), currentYearProfit, total: totalEquity },
      totals:      { totalAssets, liabilitiesPlusEquity, balanced: Math.abs(totalAssets - liabilitiesPlusEquity) < 0.01 },
    });
  } catch (err) {
    console.error("getBalanceSheet error:", err);
    return sendStructuredError(res, {
      code: "REPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ---------------------------------------------------------------------------
// GET /api/dashboard/summary
// ---------------------------------------------------------------------------

async function getDashboardSummary(req, res) {
  try {
    const { voucherIds, financialYearId } = await resolveFilter(req.query);
    const map = await buildAccountMap(voucherIds, financialYearId);
    const revenueSplit = await computeRevenueSplit(voucherIds);
    const departmentSummary = await getDepartmentSummaryData(voucherIds);

    let revenue = 0, expenses = 0, cashBalance = 0, receivables = 0, payables = 0;

    for (const row of map.values()) {
      if (row.type === "revenue") revenue     += row.credit - row.debit;
      if (row.type === "expense") expenses    += row.debit  - row.credit;
      if (row.type === "asset") {
        const name = (row.account || "").toLowerCase();
        if (name === "cash" || name.includes("bank")) {
          cashBalance += row.balance;
        } else if (row.account === "Accounts Receivable") {
          receivables = row.balance;
        }
      }
      if (row.type === "liability") {
        payables += Math.max(0, -row.balance);
      }
    }

    const opAgg = await BankAccount.aggregate([
      { $group: { _id: null, total: { $sum: "$balance" } } },
    ]);
    const operationalCashBank = opAgg[0] ? Number(opAgg[0].total) || 0 : 0;

    const negativeOperational = operationalCashBank < 0;
    const negativeAccounting = cashBalance < 0;
    const negativeCashDetected = negativeOperational || negativeAccounting;

    let warning = null;
    if (negativeCashDetected) {
      warning = "Financial data inconsistent. Reset recommended.";
      // eslint-disable-next-line no-console
      console.warn(
        "[FinanceOS] Negative cash/bank detected:",
        { operationalCashBank, accountingCashBank: cashBalance },
      );
    }

    return res.json({
      revenue:     round(revenue),
      expenses:    round(expenses),
      profit:      round(revenue - expenses),
      cashBalance: round(cashBalance),
      receivables: round(receivables),
      payables:    round(payables),
      revenueSplit,
      departmentSummary,
      operationalCashBank: round(operationalCashBank),
      negativeCashDetected,
      warning,
    });
  } catch (err) {
    console.error("getDashboardSummary error:", err);
    return sendStructuredError(res, {
      code: "REPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function getDepartmentSummaryData(voucherIds) {
  const base = {
    academy: { revenue: 0, expenses: 0, profit: 0 },
    tech: { revenue: 0, expenses: 0, profit: 0 },
    marketing: { revenue: 0, expenses: 0, profit: 0 },
  };
  if (!voucherIds || voucherIds.length === 0) return base;

  const [vouchers, revenueAccounts, expenseAccounts, entries] = await Promise.all([
    Voucher.find({ _id: { $in: voucherIds } }).select("_id referenceType referenceId department").lean(),
    Account.find({ type: "revenue" }).select("_id").lean(),
    Account.find({ type: "expense" }).select("_id").lean(),
    VoucherEntry.find({ voucherId: { $in: voucherIds } }).select("voucherId accountId debit credit").lean(),
  ]);
  const voucherDepartmentMap = await buildVoucherDepartmentMap(vouchers);
  const revenueSet = new Set(revenueAccounts.map((a) => String(a._id)));
  const expenseSet = new Set(expenseAccounts.map((a) => String(a._id)));

  for (const e of entries) {
    const dep = voucherDepartmentMap.get(String(e.voucherId)) || "tech";
    const row = base[dep] || base.tech;
    const debit = Number(e.debit) || 0;
    const credit = Number(e.credit) || 0;
    if (revenueSet.has(String(e.accountId))) row.revenue += credit - debit;
    if (expenseSet.has(String(e.accountId))) row.expenses += debit - credit;
  }
  for (const dep of ["academy", "tech", "marketing"]) {
    base[dep].revenue = round(base[dep].revenue);
    base[dep].expenses = round(base[dep].expenses);
    base[dep].profit = round(base[dep].revenue - base[dep].expenses);
  }
  return base;
}

// ---------------------------------------------------------------------------
// GET /api/dashboard/monthly
// Returns [{ month, revenue, expenses }, ...] for the active FY
// ---------------------------------------------------------------------------

async function getDashboardMonthly(req, res) {
  try {
    const { voucherIds } = await resolveFilter(req.query);
    if (!voucherIds || voucherIds.length === 0) {
      return res.json([]);
    }

    const [vouchers, revenueAccounts, expenseAccounts] = await Promise.all([
      Voucher.find({ _id: { $in: voucherIds } }).select("_id date").lean(),
      Account.find({ type: "revenue" }).select("_id").lean(),
      Account.find({ type: "expense" }).select("_id").lean(),
    ]);

    const revenueSet = new Set(revenueAccounts.map((a) => String(a._id)));
    const expenseSet = new Set(expenseAccounts.map((a) => String(a._id)));

    const voucherMonthMap = new Map();
    const voucherIdsByMonth = new Map();
    for (const v of vouchers) {
      const d = new Date(v.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      voucherMonthMap.set(String(v._id), key);
      if (!voucherIdsByMonth.has(key)) voucherIdsByMonth.set(key, []);
      voucherIdsByMonth.get(key).push(v._id);
    }

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const entries = await VoucherEntry.find({ voucherId: { $in: voucherIds } })
      .select("voucherId accountId debit credit")
      .lean();

    const totalsByMonth = new Map();
    for (const e of entries) {
      const key = voucherMonthMap.get(String(e.voucherId));
      if (!key) continue;
      if (!totalsByMonth.has(key)) totalsByMonth.set(key, { revenue: 0, expenses: 0 });
      const row = totalsByMonth.get(key);
      const accountId = String(e.accountId);
      const debit = Number(e.debit) || 0;
      const credit = Number(e.credit) || 0;
      if (revenueSet.has(accountId)) row.revenue += credit - debit;
      if (expenseSet.has(accountId)) row.expenses += debit - credit;
    }

    const result = [];
    for (const key of [...voucherIdsByMonth.keys()].sort()) {
      const [y, m] = key.split("-").map(Number);
      const totals = totalsByMonth.get(key) ?? { revenue: 0, expenses: 0 };
      result.push({
        month: monthNames[m - 1],
        year: y,
        monthKey: key,
        revenue: round(totals.revenue),
        expenses: round(totals.expenses),
      });
    }
    result.sort((a, b) => a.monthKey.localeCompare(b.monthKey));

    return res.json(result);
  } catch (err) {
    console.error("getDashboardMonthly error:", err);
    return sendStructuredError(res, {
      code: "REPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

module.exports = {
  getTrialBalance,
  getLedgerByAccount,
  exportTrialBalanceCsv,
  exportLedgerCsv,
  getProfitLoss,
  getRevenueSplit,
  getDepartmentSummary,
  getCashFlow,
  getBalanceSheet,
  getDashboardSummary,
  getDashboardMonthly,
  /** @internal Used by finance diagnostics — same rules as reports */
  buildAccountMap,
  loadOpeningBalances,
  resolveFilter,
  round,
};
