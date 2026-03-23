/**
 * Migration: backfill VoucherEntry.accountId from VoucherEntry.account (string)
 *
 * Idempotent — only touches rows where accountId is null.
 * Uses raw MongoDB collection access because the `account` string field
 * has been removed from the Mongoose schema (but still exists in DB documents).
 */

const mongoose = require("mongoose");
const Account       = require("../models/Account");
const Voucher       = require("../models/Voucher");
const FinancialYear = require("../models/FinancialYear");

const KNOWN_TYPES = {
  "Cash":                "asset",
  "Accounts Receivable": "asset",
  "Bank":                "asset",
  "GST Payable":         "liability",
  "Accounts Payable":    "liability",
  "Tax Payable":         "liability",
  "Revenue":             "revenue",
  "Sales":               "revenue",
  "Income":              "revenue",
  "Expense":             "expense",
  "Expenses":            "expense",
  "General Expense":     "expense",
  "Cost of Goods Sold":  "expense",
  "COGS":                "expense",
};

function inferType(name) {
  return KNOWN_TYPES[name] ?? "expense";
}

// ---------------------------------------------------------------------------
// Migration 1: backfill VoucherEntry.accountId
// ---------------------------------------------------------------------------

async function migrateVoucherEntries() {
  const col = mongoose.connection.collection("voucherentries");

  const unmigrated = await col.distinct("account", {
    accountId: null,
    account:   { $nin: [null, ""] },
  });

  if (unmigrated.length === 0) {
    console.log("Migration: VoucherEntry accountId — nothing to migrate.");
    return;
  }

  console.log(`Migration: backfilling accountId for ${unmigrated.length} account name(s):`, unmigrated);

  for (const name of unmigrated) {
    if (!name) continue;

    const account = await Account.findOneAndUpdate(
      { name },
      { $setOnInsert: { name, type: inferType(name), isActive: true } },
      { upsert: true, new: true }
    );

    const result = await col.updateMany(
      { account: name, accountId: null },
      { $set: { accountId: account._id } }
    );

    console.log(`Migration: "${name}" → ${result.modifiedCount} row(s) updated (accountId: ${account._id})`);
  }

  console.log("Migration: VoucherEntry backfill complete.");
}

// ---------------------------------------------------------------------------
// Migration 2: backfill Voucher.financialYearId
// Matches each voucher's date against all FY date ranges.
// Falls back to the active (open) FY for vouchers with no date or no match.
// ---------------------------------------------------------------------------

async function migrateVoucherFinancialYear() {
  // Only process vouchers that have no financialYearId yet
  const unassigned = await Voucher.find({ financialYearId: null }).lean();

  if (unassigned.length === 0) {
    console.log("Migration: Voucher financialYearId — nothing to migrate.");
    return;
  }

  console.log(`Migration: assigning financialYearId to ${unassigned.length} voucher(s).`);

  const allYears = await FinancialYear.find().sort({ startDate: 1 }).lean();
  if (allYears.length === 0) {
    console.warn("Migration: no FinancialYear documents found — skipping Voucher FY migration.");
    return;
  }

  // Active FY used as fallback for vouchers whose date doesn't fall in any range
  const activeFY = allYears.find((y) => !y.isClosed) ?? allYears[allYears.length - 1];

  let matched = 0;
  let fallback = 0;

  for (const voucher of unassigned) {
    const vDate = voucher.date ? new Date(voucher.date) : null;

    let assignedFY = null;

    if (vDate) {
      assignedFY = allYears.find(
        (fy) => vDate >= new Date(fy.startDate) && vDate <= new Date(fy.endDate)
      ) ?? null;
    }

    if (!assignedFY) {
      assignedFY = activeFY;
      fallback++;
    } else {
      matched++;
    }

    await Voucher.updateOne(
      { _id: voucher._id },
      { $set: { financialYearId: assignedFY._id } }
    );
  }

  console.log(`Migration: Voucher FY backfill complete — ${matched} date-matched, ${fallback} fallback to active FY.`);
}

module.exports = { migrateVoucherEntries, migrateVoucherFinancialYear };
