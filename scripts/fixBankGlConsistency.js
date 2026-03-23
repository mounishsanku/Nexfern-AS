/**
 * fixBankGlConsistency.js
 *
 * 1) Logs GL Cash+Bank vs sum of operational BankAccount balances (same check as system validation).
 * 2) Scans vouchers that should have a BankTransaction mirror (expense, payment, tds_payment, payroll)
 *    and reports missing or amount-mismatched rows.
 * 3) Optional --fix: creates missing BankTransaction rows via recordBankTransaction (uses default Cash
 *    wallet when bankAccountId cannot be inferred — review after running).
 *
 * Usage (repo root):
 *   node scripts/fixBankGlConsistency.js
 *   node scripts/fixBankGlConsistency.js --fix
 */

const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config({ path: path.join(__dirname, "../server/.env") });

const { connectDb } = require("../server/src/config/db");
const BankAccount = require("../server/src/models/BankAccount");
const BankTransaction = require("../server/src/models/BankTransaction");
const Voucher = require("../server/src/models/Voucher");
const VoucherEntry = require("../server/src/models/VoucherEntry");
const Account = require("../server/src/models/Account");
const { buildAccountMap, resolveFilter, round } = require("../server/src/controllers/reportController");
const { recordBankTransaction } = require("../server/src/services/bankService");

const EPS = 0.02;

async function glVsOps() {
  const bankAccs = await BankAccount.find({}).select("name balance").lean();
  const { voucherIds, financialYearId } = await resolveFilter({});
  const accMap = await buildAccountMap(voucherIds, financialYearId);
  let glCash = 0;
  let glBank = 0;
  for (const row of accMap.values()) {
    if (row.account === "Cash") glCash = Number(row.balance) || 0;
    else if (row.account === "Bank") glBank = Number(row.balance) || 0;
  }
  const opsCashRow = bankAccs.find((b) => b.name === "Cash");
  const opsBankRows = bankAccs.filter((b) => b.name !== "Cash");
  const opsCashBal = opsCashRow ? Number(opsCashRow.balance) || 0 : 0;
  const opsBankBal = opsBankRows.reduce((s, b) => s + (Number(b.balance) || 0), 0);
  const glTotal = glCash + glBank;
  const opsTotal = opsCashBal + opsBankBal;
  return {
    glCash,
    glBank,
    glTotal,
    opsCashBal,
    opsBankBal,
    opsTotal,
    diff: Math.abs(glTotal - opsTotal),
  };
}

async function sumCashBankGlForVoucher(voucherId) {
  const cash = await Account.findOne({ name: "Cash" }).select("_id").lean();
  const bank = await Account.findOne({ name: "Bank" }).select("_id").lean();
  const ids = [cash?._id, bank?._id].filter(Boolean);
  if (!ids.length) return { debit: 0, credit: 0 };
  const rows = await VoucherEntry.find({ voucherId, accountId: { $in: ids } }).lean();
  let debit = 0;
  let credit = 0;
  for (const r of rows) {
    debit += Number(r.debit) || 0;
    credit += Number(r.credit) || 0;
  }
  return { debit, credit };
}

function expectedBankTx({ referenceType, voucher, cashBank }) {
  const rt = String(referenceType || "").toLowerCase();
  const { debit, credit } = cashBank;
  if (rt === "expense" || rt === "tds_payment" || rt === "payroll") {
    return { type: "debit", amount: round(credit) };
  }
  if (rt === "payment") {
    return { type: "credit", amount: round(debit) };
  }
  return null;
}

async function findExistingTx(refType, refId) {
  if (!refId) return null;
  return BankTransaction.findOne({
    referenceType: refType,
    referenceId: refId,
  }).lean();
}

async function scanVouchers(fix) {
  const vouchers = await Voucher.find({
    referenceType: { $in: ["expense", "payment", "tds_payment", "payroll"] },
  })
    .select("_id referenceType referenceId")
    .lean();

  let missing = 0;
  let mismatch = 0;
  let fixed = 0;

  for (const v of vouchers) {
    const cashBank = await sumCashBankGlForVoucher(v._id);
    const exp = expectedBankTx({ referenceType: v.referenceType, voucher: v, cashBank });
    if (!exp || exp.amount <= EPS) continue;

    const rt = String(v.referenceType).toLowerCase();
    /** BankTransaction.referenceId for TDS payments is always the voucher _id */
    const refId = rt === "tds_payment" ? v._id : v.referenceId;
    if (!refId) {
      // eslint-disable-next-line no-console
      console.warn("[skip] voucher without referenceId", String(v._id), rt);
      continue;
    }

    const txRefType =
      rt === "tds_payment" ? "tds_payment" : rt === "payroll" ? "payroll" : rt === "payment" ? "payment" : "expense";

    const existing = await findExistingTx(txRefType, refId);
    if (!existing) {
      missing += 1;
      // eslint-disable-next-line no-console
      console.log(
        `[MISSING] ${txRefType} ref=${String(refId)} voucher=${String(v._id)} expected ${exp.type} ${exp.amount}`,
      );
      if (fix) {
        try {
          await recordBankTransaction({
            bankAccountId: null,
            type: exp.type,
            amount: exp.amount,
            referenceType: txRefType,
            referenceId: refId,
          });
          fixed += 1;
          // eslint-disable-next-line no-console
          console.log(`  → created BankTransaction (default Cash wallet)`);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(`  → failed:`, e.message);
        }
      }
      continue;
    }

    const amt = Number(existing.amount) || 0;
    const typ = String(existing.type).toLowerCase();
    if (Math.abs(amt - exp.amount) > EPS || typ !== exp.type) {
      mismatch += 1;
      // eslint-disable-next-line no-console
      console.log(
        `[MISMATCH] ${txRefType} ref=${String(refId)} voucher=${String(v._id)} expected ${exp.type} ${exp.amount}, got ${typ} ${amt}`,
      );
    }
  }

  return { missing, mismatch, fixed };
}

async function main() {
  const fix = process.argv.includes("--fix");
  await connectDb();

  const g = await glVsOps();
  // eslint-disable-next-line no-console
  console.log("\n=== Bank vs GL (Cash + Bank chart vs operational accounts) ===");
  // eslint-disable-next-line no-console
  console.log(`GL Cash: ${round(g.glCash)}  GL Bank: ${round(g.glBank)}  GL total: ${round(g.glTotal)}`);
  // eslint-disable-next-line no-console
  console.log(`Ops Cash: ${round(g.opsCashBal)}  Ops other banks: ${round(g.opsBankBal)}  Ops total: ${round(g.opsTotal)}`);
  // eslint-disable-next-line no-console
  console.log(`Difference: ${round(g.diff)} ${g.diff <= EPS ? "(OK)" : "(NEEDS REVIEW)"}`);

  // eslint-disable-next-line no-console
  console.log("\n=== Voucher ↔ BankTransaction mirror scan ===");
  const r = await scanVouchers(fix);
  // eslint-disable-next-line no-console
  console.log(`\nSummary: missing=${r.missing} mismatch=${r.mismatch}${fix ? ` fixed=${r.fixed}` : ""}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
