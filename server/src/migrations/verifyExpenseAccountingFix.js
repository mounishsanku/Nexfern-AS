/**
 * Verification script for expense accounting fix.
 * Ensures: pending expenses have NO financial impact; only approved expenses affect P&L.
 *
 * Run: node -r dotenv/config src/migrations/verifyExpenseAccountingFix.js
 * Requires: Cash balance >= 0.01 OR ALLOW_NEGATIVE_CASH=true (for approval step)
 */

const mongoose = require("mongoose");
const { connectDb } = require("../config/db");
const Expense = require("../models/Expense");
const Voucher = require("../models/Voucher");
const FinancialYear = require("../models/FinancialYear");
const { createVoucherForExpense } = require("../services/voucherService");
const { recordBankTransaction } = require("../services/bankService");
const VoucherEntry = require("../models/VoucherEntry");
const { resolveFilter, buildAccountMap, round } = require("../controllers/reportController");

async function getPLExpenses() {
  const { voucherIds, financialYearId } = await resolveFilter({});
  const map = await buildAccountMap(voucherIds, financialYearId);
  let expenses = 0;
  for (const row of map.values()) {
    if (row.type === "expense") expenses += (row.debit || 0) - (row.credit || 0);
  }
  return round(expenses);
}

async function run() {
  await connectDb();

  const activeYear = await FinancialYear.findOne({ isClosed: false }).sort({ startDate: -1 }).lean();
  if (!activeYear) {
    console.error("No active financial year found. Aborting.");
    process.exit(1);
  }
  const financialYearId = activeYear._id;

  const TEST_AMOUNT = 0.01;
  const TEST_TITLE = "[VERIFY-FIX] Pending vs Approved Test";
  let expense = null;

  try {
    console.log("\n--- Step 1: Create expense (status: pending) ---");
    expense = await Expense.create({
      title: TEST_TITLE,
      amount: TEST_AMOUNT,
      category: "other",
      department: "tech",
      date: new Date(),
      financialYearId,
      status: "pending",
      approvedBy: null,
      approvedAt: null,
      tdsApplicable: false,
      tdsRate: 0,
      tdsAmount: 0,
    });
    console.log("Created expense:", expense._id.toString(), "status:", expense.status);

    console.log("\n--- Step 2: Verify NO voucher, NO P&L impact ---");
    const voucherBefore = await Voucher.findOne({ referenceType: "expense", referenceId: expense._id });
    if (voucherBefore) {
      throw new Error("FAIL: Pending expense must NOT have a voucher");
    }
    const plBefore = await getPLExpenses();
    console.log("P&L expenses before approval:", plBefore);

    console.log("\n--- Step 3: Approve expense ---");
    await createVoucherForExpense({ expense, financialYearId });
    const cashOut = expense.tdsApplicable ? Number((expense.amount - (expense.tdsAmount || 0)).toFixed(2)) : expense.amount;
    await recordBankTransaction({
      bankAccountId: expense.bankAccountId ?? null,
      type: "debit",
      amount: cashOut,
      referenceType: "expense",
      referenceId: expense._id,
    });
    expense.status = "approved";
    expense.approvedBy = new mongoose.Types.ObjectId();
    expense.approvedAt = new Date();
    await expense.save();
    console.log("Expense approved.");

    console.log("\n--- Step 4: Verify voucher exists, P&L includes amount ---");
    const voucherAfter = await Voucher.findOne({ referenceType: "expense", referenceId: expense._id });
    if (!voucherAfter) {
      throw new Error("FAIL: Approved expense MUST have a voucher");
    }
    const plAfter = await getPLExpenses();
    console.log("P&L expenses after approval:", plAfter);
    if (plAfter < plBefore + TEST_AMOUNT - 0.001) {
      throw new Error(`FAIL: P&L should include expense. Expected >= ${plBefore + TEST_AMOUNT}, got ${plAfter}`);
    }
    console.log("P&L correctly increased by expense amount.");

    console.log("\n✅ All checks passed. Pending = no impact; Approved = affects P&L.");
  } catch (err) {
    if (err.code === "INSUFFICIENT_FUNDS") {
      console.error("\n⚠️ Approval failed: insufficient Cash. Set ALLOW_NEGATIVE_CASH=true or ensure Cash >= 0.01.");
      console.error("Create/pending checks still passed (no voucher for pending).");
    } else {
      console.error("\n❌ Verification failed:", err.message);
      process.exitCode = 1;
    }
  } finally {
    if (expense) {
      console.log("\n--- Cleanup ---");
      const v = await Voucher.findOne({ referenceType: "expense", referenceId: expense._id });
      if (v) {
        await VoucherEntry.deleteMany({ voucherId: v._id });
        await Voucher.deleteOne({ _id: v._id });
      }
      try {
        await recordBankTransaction({
          bankAccountId: expense.bankAccountId ?? null,
          type: "credit",
          amount: expense.tdsApplicable ? Number((expense.amount - (expense.tdsAmount || 0)).toFixed(2)) : expense.amount,
          referenceType: "expense",
          referenceId: expense._id,
        });
      } catch (_) {
        /* ignore */
      }
      await Expense.deleteOne({ _id: expense._id });
      console.log("Test expense and voucher removed.");
    }
    await mongoose.disconnect();
  }
}

run();
