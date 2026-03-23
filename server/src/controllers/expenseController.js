const mongoose = require("mongoose");
const Expense  = require("../models/Expense");
const Voucher = require("../models/Voucher");
const VoucherEntry = require("../models/VoucherEntry");
const BankAccount = require("../models/BankAccount");
const { logAction, buildMetadata, ACTIONS } = require("../utils/audit");
const { recordBankTransaction } = require("../services/bankService");
const { createVoucherForExpense, expenseAccountNameForCategory } = require("../services/voucherService");
const { normalizeDepartment } = require("../utils/department");
const { round2 } = require("../utils/round");
const { getAccountByName } = require("../services/accountService");
const { assertPostTransactionAccountingInvariants } = require("../services/accountingInvariantsService");
const { validateAndHealBeforeTransaction } = require("../services/systemHealService");
const { sendInternalError, ACTION } = require("../utils/httpErrorResponse");

function toFiniteNumber(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseYMDToUTCDate(ymd) {
  if (typeof ymd !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

async function getPaymentSourceBalance(bankAccountId) {
  if (bankAccountId && mongoose.Types.ObjectId.isValid(String(bankAccountId))) {
    const acc = await BankAccount.findById(bankAccountId).lean();
    return acc ? Number(acc.balance) || 0 : 0;
  }
  const cash = await BankAccount.findOne({ name: "Cash" }).lean();
  return cash ? Number(cash.balance) || 0 : 0;
}

/**
 * Ensures chart accounts exist for expense vouchers (same names as voucherService.createVoucherForExpense).
 */
async function ensureExpenseVoucherAccounts({ category, tdsApplicable, tdsAmount, usesBankWallet }) {
  const glName = expenseAccountNameForCategory(category);
  await getAccountByName(glName, "expense");
  await getAccountByName("Cash", "asset");
  if (usesBankWallet) {
    await getAccountByName("Bank", "asset");
  }
  if (tdsApplicable && Number(tdsAmount) > 0) {
    await getAccountByName("TDS Payable", "liability");
  }
}

async function removeExpenseVoucherOnly(expenseId) {
  const voucher = await Voucher.findOne({ referenceType: "expense", referenceId: expenseId });
  if (voucher) {
    await VoucherEntry.deleteMany({ voucherId: voucher._id });
    await Voucher.deleteOne({ _id: voucher._id });
  }
}

async function removeExpenseVoucherChain(expenseId) {
  await removeExpenseVoucherOnly(expenseId);
  await Expense.deleteOne({ _id: expenseId });
}

// ---------------------------------------------------------------------------
// POST /api/expenses
// ---------------------------------------------------------------------------

async function createExpense(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required", code: "UNAUTHORIZED" });
    }
    const role = String(req.user?.role || "").toLowerCase();
    const isApprover = role === "admin" || role === "accountant";

    const {
      title, amount, category, vendorId, attachmentUrl, billUrl,
      date, bankAccountId, isRecurring, recurringInterval, tdsApplicable, tdsRate, department,
    } = req.body ?? {};

    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ message: "title is required", code: "EXPENSE_TITLE_REQUIRED" });
    }
    if (!category || typeof category !== "string" || !category.trim()) {
      return res.status(400).json({ message: "category is required", code: "EXPENSE_CATEGORY_REQUIRED" });
    }
    const parsedAmount = toFiniteNumber(amount);
    if (parsedAmount === null || parsedAmount <= 0) {
      return res.status(400).json({ message: "amount must be a valid number > 0", code: "EXPENSE_AMOUNT_INVALID" });
    }

    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      return res.status(400).json({ message: "date is required (YYYY-MM-DD)", code: "EXPENSE_DATE_REQUIRED" });
    }
    const expenseDate = parseYMDToUTCDate(date.trim());
    if (!expenseDate) {
      return res.status(400).json({ message: "date is invalid", code: "EXPENSE_DATE_INVALID" });
    }

    if (vendorId !== undefined && vendorId !== null && vendorId !== "") {
      if (!mongoose.Types.ObjectId.isValid(String(vendorId))) {
        return res.status(400).json({ message: "invalid vendorId", code: "EXPENSE_VENDOR_INVALID" });
      }
    }

    const financialYearId = req.activeYear?._id ?? null;
    await validateAndHealBeforeTransaction(financialYearId);

    const recurring = Boolean(isRecurring);
    const interval  = recurring && recurringInterval === "monthly" ? "monthly" : null;
    if (recurring && !isApprover) {
      return res.status(400).json({
        message: "Only accountant or admin can create recurring expense templates",
        code: "EXPENSE_RECURRING_NOT_ALLOWED",
      });
    }

    const tdsOn = Boolean(tdsApplicable);
    const parsedTdsRate = tdsOn ? toFiniteNumber(tdsRate) : 0;
    if (tdsOn && (parsedTdsRate === null || parsedTdsRate < 0 || parsedTdsRate > 30)) {
      return res.status(400).json({ message: "tdsRate must be between 0 and 30", code: "EXPENSE_TDS_RATE_INVALID" });
    }
    const computedTdsAmount = tdsOn ? round2((parsedAmount * parsedTdsRate) / 100) : 0;

    const normalizedDepartment = normalizeDepartment(department) || "tech";

    const bankRef =
      bankAccountId && mongoose.Types.ObjectId.isValid(String(bankAccountId)) ? bankAccountId : null;

    const basePayload = {
      title:             title.trim(),
      amount:            parsedAmount,
      category:          category.trim().toLowerCase(),
      department:        normalizedDepartment,
      vendorId:          vendorId && mongoose.Types.ObjectId.isValid(String(vendorId)) ? vendorId : null,
      attachmentUrl:     attachmentUrl || null,
      billUrl:           billUrl || attachmentUrl || null,
      date:              expenseDate,
      financialYearId,
      isRecurring:       recurring,
      recurringInterval: interval,
      tdsApplicable:     tdsOn,
      tdsRate:           tdsOn ? parsedTdsRate : 0,
      tdsAmount:         computedTdsAmount,
      bankAccountId:     bankRef,
      createdAt:         new Date(),
    };

    const created = await Expense.create({
      ...basePayload,
      status:     "pending",
      approvedBy: null,
      approvedAt: null,
    });

    await logAction(userId, ACTIONS.CREATE, "expense", created._id, buildMetadata(null, {
      title: created.title, amount: created.amount, category: created.category,
      status: "pending",
      vendorId: created.vendorId?.toString?.(), isRecurring: created.isRecurring,
      tdsApplicable: created.tdsApplicable, tdsRate: created.tdsRate, tdsAmount: created.tdsAmount,
      department: created.department,
    }));

    const populated = await Expense.findById(created._id).populate("vendorId", "name").lean();
    return res.status(201).json(populated);
  } catch (err) {
    console.error(err);
    return sendInternalError(res, err, { code: "EXPENSE_CREATE_FAILED", action: ACTION.RETRY });
  }
}

// ---------------------------------------------------------------------------
// POST /api/expenses/:id/approve
// ---------------------------------------------------------------------------

async function approveExpense(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required", code: "UNAUTHORIZED" });
    }
    const { id } = req.params ?? {};
    const { bankAccountId } = req.body ?? {};

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid expense id", code: "EXPENSE_ID_INVALID" });
    }

    const financialYearId = req.activeYear?._id ?? null;

    const expense = await Expense.findById(id);
    if (!expense) return res.status(404).json({ message: "Expense not found" });
    const existingExpenseVoucher = await Voucher.findOne({
      referenceType: "expense",
      referenceId: expense._id,
    })
      .select("_id")
      .lean();
    if (expense.status === "approved") {
      if (existingExpenseVoucher) {
        return res.status(409).json({
          message: "Expense already processed (posting voucher exists)",
          code: "ALREADY_PROCESSED",
        });
      }
      return res.status(409).json({
        message:
          "Expense is marked approved but has no voucher — data is inconsistent. Run diagnostics or reset.",
        code: "EXPENSE_STATE_CORRUPT",
      });
    }
    if (expense.status === "rejected") {
      return res.status(400).json({ message: "Cannot approve a rejected expense", code: "EXPENSE_REJECTED" });
    }
    if (expense.status !== "pending") {
      return res.status(400).json({ message: "Expense is not pending approval", code: "EXPENSE_NOT_PENDING" });
    }

    const tdsOn = Boolean(expense.tdsApplicable);
    const gross = Number(expense.amount) || 0;
    const tdsAmt = tdsOn ? Number(expense.tdsAmount) || 0 : 0;
    const netAmount = round2(gross - tdsAmt);

    const bankRef =
      bankAccountId && mongoose.Types.ObjectId.isValid(String(bankAccountId))
        ? bankAccountId
        : expense.bankAccountId;

    let usesBankWallet = false;
    if (bankRef && mongoose.Types.ObjectId.isValid(String(bankRef))) {
      const ba = await BankAccount.findById(bankRef).select("name").lean();
      usesBankWallet = Boolean(ba && ba.name !== "Cash");
    }

    await ensureExpenseVoucherAccounts({
      category: expense.category,
      tdsApplicable: tdsOn,
      tdsAmount: tdsAmt,
      usesBankWallet,
    });

    const cashOut = tdsOn ? netAmount : gross;

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const { alreadyExisted } = await createVoucherForExpense({
          expense,
          financialYearId,
          session,
          bankAccountId: bankRef ?? null,
        });
        if (alreadyExisted) {
          const err = new Error("Expense already processed");
          err.code = "ALREADY_PROCESSED";
          throw err;
        }
        await recordBankTransaction({
          bankAccountId: bankRef ?? null,
          type: "debit",
          amount: cashOut,
          referenceType: "expense",
          referenceId: expense._id,
          session,
        });
        await Expense.updateOne(
          { _id: expense._id },
          {
            $set: {
              status: "approved",
              approvedBy: userId,
              approvedAt: new Date(),
              ...(bankRef ? { bankAccountId: bankRef } : {}),
            },
          },
          { session },
        );
        await assertPostTransactionAccountingInvariants(financialYearId, session);
      });
    } catch (err) {
      if (err?.code === "ALREADY_PROCESSED") {
        return res.status(409).json({ message: "Expense already processed", code: "ALREADY_PROCESSED" });
      }
      if (err?.code === "INSUFFICIENT_FUNDS") {
        return res.status(400).json({ message: "Insufficient funds", code: "INSUFFICIENT_FUNDS" });
      }
      if (
        err?.code === "BANK_GL_BLOCK" ||
        err?.code === "ACCOUNTING_INVARIANT_BANK_GL" ||
        err?.code === "ACCOUNTING_INVARIANT_BALANCE_SHEET" ||
        err?.code === "ACCOUNTING_INVARIANT_NEGATIVE_BANK"
      ) {
        return res.status(err.status || 503).json({
          message: err.message,
          code: err.code,
          metrics: err.metrics,
        });
      }
      if (err?.message?.includes("Voucher") || err?.message?.includes("voucher")) {
        return res.status(400).json({ message: err.message, code: "VOUCHER_CREATE_FAILED" });
      }
      console.error(err);
      return sendInternalError(res, err, { code: "EXPENSE_APPROVE_FAILED", action: ACTION.RETRY });
    } finally {
      await session.endSession();
    }

    const populated = await Expense.findById(id).populate("vendorId", "name").lean();
    await logAction(
      userId,
      ACTIONS.APPROVE,
      "expense",
      id,
      buildMetadata({ status: "pending" }, { status: "approved" }),
    );

    return res.json(populated);
  } catch (err) {
    if (
      err?.code === "BANK_GL_BLOCK" ||
      err?.code === "ACCOUNTING_INVARIANT_BANK_GL" ||
      err?.code === "ACCOUNTING_INVARIANT_BALANCE_SHEET"
    ) {
      return res.status(err.status || 503).json({
        message: err.message,
        code: err.code,
        metrics: err.metrics,
      });
    }
    console.error(err);
    return sendInternalError(res, err, { code: "EXPENSE_APPROVE_FAILED", action: ACTION.RETRY });
  }
}

// ---------------------------------------------------------------------------
// POST /api/expenses/:id/reject
// ---------------------------------------------------------------------------

async function rejectExpense(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required", code: "UNAUTHORIZED" });
    }
    const { id } = req.params ?? {};
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid expense id", code: "EXPENSE_ID_INVALID" });
    }

    const expense = await Expense.findById(id);
    if (!expense) return res.status(404).json({ message: "Expense not found" });
    if (expense.status !== "pending") {
      return res.status(400).json({ message: "Expense is not pending approval", code: "EXPENSE_NOT_PENDING" });
    }

    expense.status = "rejected";
    expense.approvedBy = userId;
    expense.approvedAt = new Date();
    await expense.save();

    await logAction(
      userId,
      ACTIONS.UPDATE,
      "expense",
      expense._id,
      buildMetadata({ status: "pending" }, { status: "rejected" }),
    );

    const populated = await Expense.findById(id).populate("vendorId", "name").lean();
    return res.json(populated);
  } catch (err) {
    console.error(err);
    return sendInternalError(res, err, { code: "EXPENSE_REJECT_FAILED", action: ACTION.RETRY });
  }
}

// ---------------------------------------------------------------------------
// GET /api/expenses  — filters: startDate, endDate, category, vendorId
// ---------------------------------------------------------------------------

async function getExpenses(req, res) {
  try {
    const { startDate, endDate, category, vendorId, department, status } = req.query ?? {};

    const filter = {};

    const start = parseYMDToUTCDate(startDate);
    const end   = parseYMDToUTCDate(endDate);
    if (start || end) {
      filter.date = {};
      if (start) filter.date.$gte = start;
      if (end)   filter.date.$lte = new Date(Date.UTC(
        end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999,
      ));
    }

    if (category && typeof category === "string") {
      filter.category = category.toLowerCase();
    }
    if (vendorId && typeof vendorId === "string") {
      filter.vendorId = vendorId;
    }
    const normalizedDepartment = normalizeDepartment(department);
    if (normalizedDepartment) {
      filter.department = normalizedDepartment;
    }
    if (status && typeof status === "string" && ["pending", "approved", "rejected"].includes(status.toLowerCase())) {
      filter.status = status.toLowerCase();
    }

    const expenses = await Expense.find(filter)
      .populate("vendorId", "name email phone")
      .sort({ date: -1, createdAt: -1 })
      .lean();

    return res.json(expenses);
  } catch (err) {
    console.error(err);
    return sendInternalError(res, err, { code: "EXPENSE_LIST_FAILED", action: ACTION.RETRY });
  }
}

// ---------------------------------------------------------------------------
// POST /api/expenses/upload  — multer handled in route
// ---------------------------------------------------------------------------

async function uploadAttachment(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: "no file uploaded" });
    const url = `/uploads/expenses/${req.file.filename}`;
    return res.json({ url, billUrl: url });
  } catch (err) {
    console.error(err);
    return sendInternalError(res, err, { code: "EXPENSE_UPLOAD_FAILED", action: ACTION.RETRY });
  }
}

// ---------------------------------------------------------------------------
// POST /api/expenses/run-recurring
// Duplicate approved monthly templates as new pending rows (no voucher until approved).
// ---------------------------------------------------------------------------

async function runRecurring(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required", code: "UNAUTHORIZED" });
    }
    const financialYearId = req.activeYear?._id ?? null;

    if (!financialYearId) {
      return res.status(400).json({ message: "Active financial year is required", code: "ACTIVE_FY_REQUIRED" });
    }

    await validateAndHealBeforeTransaction(financialYearId);

    const now = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth();

    const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const monthEnd   = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

    const templates = await Expense.find({
      isRecurring:      true,
      recurringInterval: "monthly",
      recurringSourceId: null,
      status:            "approved",
    }).lean();

    if (!templates.length) {
      return res.status(200).json({
        message: "No recurring templates found",
        code: "NO_RECURRING_TEMPLATES",
        count: 0,
        expenses: [],
      });
    }

    const created = [];
    const skipped = [];

    for (const t of templates) {
      try {
      const existing = await Expense.findOne({
        recurringSourceId: t._id,
        date:              { $gte: monthStart, $lte: monthEnd },
      });

      if (existing) {
        skipped.push({ templateId: String(t._id), reason: "Already created for this month" });
        continue;
      }

      const gross = Number(t.amount) || 0;
      if (gross <= 0) {
        skipped.push({ templateId: String(t._id), reason: "Invalid template amount" });
        continue;
      }

      const expenseDate = new Date(now);

      const child = await Expense.create({
        title:              t.title,
        amount:             t.amount,
        category:           t.category,
        vendorId:           t.vendorId,
        attachmentUrl:      null,
        billUrl:            null,
        date:               expenseDate,
        financialYearId,
        isRecurring:        false,
        recurringInterval:  null,
        recurringSourceId:  t._id,
        tdsApplicable:      Boolean(t.tdsApplicable),
        tdsRate:            Number(t.tdsRate) || 0,
        tdsAmount:          Number(t.tdsAmount) || 0,
        department:         normalizeDepartment(t.department) || "tech",
        bankAccountId:      t.bankAccountId ?? null,
        status:             "pending",
        approvedBy:         null,
        approvedAt:         null,
        createdAt:          new Date(),
      });

      await logAction(userId, ACTIONS.CREATE, "expense", child._id, buildMetadata(null, {
        title: child.title, amount: child.amount, sourceId: String(t._id),
        recurringSourceId: String(t._id),
        status: "pending",
      }));

      created.push(child);
      } catch (loopErr) {
        skipped.push({
          templateId: String(t._id),
          reason: loopErr instanceof Error ? loopErr.message : "Processing failed",
        });
      }
    }

    const populated = await Expense.find({ _id: { $in: created.map((c) => c._id) } })
      .populate("vendorId", "name")
      .lean();

    return res.status(201).json({
      message:
        created.length > 0
          ? `Created ${created.length} recurring expense(s)`
          : skipped.length > 0
            ? "No new recurring expenses created (see skipped)"
            : "No recurring expenses created",
      count: created.length,
      skipped,
      expenses: populated,
    });
  } catch (err) {
    console.error(err);
    return sendInternalError(res, err, { code: "RECURRING_RUN_FAILED", action: ACTION.RETRY });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/expenses/:id — update (title, category, vendorId only)
// ---------------------------------------------------------------------------

async function updateExpense(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const { id } = req.params ?? {};
    const { title, category, vendorId, department } = req.body ?? {};

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid expense id" });
    }

    const expense = await Expense.findById(id).lean();
    if (!expense) return res.status(404).json({ message: "Expense not found" });
    if (expense.status === "approved") {
      return res.status(403).json({
        message: "Cannot edit approved expense",
        code: "RECORD_IMMUTABLE",
      });
    }

    const update = {};
    if (typeof title === "string" && title.trim()) update.title = title.trim();
    if (typeof category === "string" && category.trim()) update.category = category.trim().toLowerCase();
    if (vendorId !== undefined) update.vendorId = vendorId || null;
    if (department !== undefined) {
      const normalizedDepartment = normalizeDepartment(department);
      if (!normalizedDepartment) {
        return res.status(400).json({ message: "invalid department" });
      }
      update.department = normalizedDepartment;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: "no fields to update" });
    }

    const before = { title: expense.title, category: expense.category, vendorId: expense.vendorId?.toString?.() };
    const updated = await Expense.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();

    await logAction(userId, ACTIONS.UPDATE, "expense", id, buildMetadata(before, {
      title: updated.title, category: updated.category, vendorId: updated.vendorId?.toString?.(), department: updated.department,
    }));

    const populated = await Expense.findById(updated._id).populate("vendorId", "name").lean();
    return res.json(populated);
  } catch (err) {
    console.error(err);
    return sendInternalError(res, err, { code: "EXPENSE_UPDATE_FAILED", action: ACTION.RETRY });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/expenses/:id
// ---------------------------------------------------------------------------

async function deleteExpense(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const { id } = req.params ?? {};

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid expense id" });
    }

    const expense = await Expense.findById(id).lean();
    if (!expense) return res.status(404).json({ message: "Expense not found" });

    if (expense.status === "approved") {
      return res.status(403).json({
        message: "Cannot delete approved expense",
        code: "RECORD_IMMUTABLE",
      });
    }

    const before = { title: expense.title, amount: expense.amount, category: expense.category };

    await Expense.findByIdAndDelete(id);

    await logAction(userId, ACTIONS.DELETE, "expense", id, buildMetadata(before, null));

    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return sendInternalError(res, err, { code: "EXPENSE_DELETE_FAILED", action: ACTION.RETRY });
  }
}

module.exports = {
  createExpense,
  getExpenses,
  uploadAttachment,
  runRecurring,
  updateExpense,
  deleteExpense,
  approveExpense,
  rejectExpense,
};
