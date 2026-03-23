const mongoose       = require("mongoose");
const Voucher        = require("../models/Voucher");
const VOUCHER_TYPES  = Voucher.VOUCHER_TYPES || [];
const VoucherEntry   = require("../models/VoucherEntry");
const Invoice        = require("../models/Invoice");
const Expense        = require("../models/Expense");
const Payment        = require("../models/Payment");
const { getAccountIdByName } = require("./accountService");
const { glAccountNameForBankAccountId } = require("./bankService");
const { allocateVoucherNumber } = require("./voucherNumberService");

function httpError(message, status, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

/** Structured voucher validation / persistence errors (never raw Mongoose). */
function throwInvalidVoucher(message, code = "INVALID_VOUCHER", extra = {}) {
  const e = new Error(message);
  e.code = code;
  Object.assign(e, extra);
  throw e;
}

/**
 * Single source of truth for posting vouchers. Validates Dr=Cr, type, entries, date;
 * allocates voucherNumber when omitted.
 *
 * @param {object} payload — type, entries (>=2), financialYearId, date (optional, defaults now),
 *   voucherNumber (optional), narration, referenceType, referenceId, invoiceId, department, reversedFrom, session
 */
async function createValidatedVoucher(payload) {
  const {
    type,
    voucherNumber: voucherNumberIn,
    date,
    entries = [],
    financialYearId,
    narration = "",
    referenceType = null,
    referenceId = null,
    invoiceId = null,
    department = null,
    reversedFrom = null,
    session = null,
  } = payload;

  if (!financialYearId) {
    throwInvalidVoucher("Active financial year is required", "INVALID_VOUCHER", { field: "financialYearId" });
  }

  const normalizedType = String(type || "")
    .trim()
    .toLowerCase();
  if (!type || !String(type).trim() || !normalizedType || !VOUCHER_TYPES.includes(normalizedType)) {
    throwInvalidVoucher(
      `Voucher type is required and must be one of: ${VOUCHER_TYPES.join(", ")}`,
      "INVALID_VOUCHER",
      { field: "type" },
    );
  }

  const voucherDate = date != null ? new Date(date) : new Date();
  if (Number.isNaN(voucherDate.getTime())) {
    throwInvalidVoucher("Invalid voucher date", "INVALID_VOUCHER", { field: "date" });
  }

  if (!Array.isArray(entries) || entries.length < 2) {
    throwInvalidVoucher("At least 2 voucher entries are required", "INVALID_VOUCHER", { field: "entries" });
  }

  for (const e of entries) {
    const debit = Number(e?.debit) || 0;
    const credit = Number(e?.credit) || 0;
    if (!e?.account || typeof e.account !== "string") {
      throwInvalidVoucher("Each voucher entry requires a valid account name", "INVALID_VOUCHER", {
        field: "entries",
      });
    }
    if (debit < 0 || credit < 0) {
      throwInvalidVoucher("Voucher debit/credit cannot be negative", "INVALID_VOUCHER", { field: "entries" });
    }
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throwInvalidVoucher("Each entry must have either debit or credit", "INVALID_VOUCHER", { field: "entries" });
    }
  }

  const totalDebit = entries.reduce((s, e) => s + (Number(e.debit) || 0), 0);
  const totalCredit = entries.reduce((s, e) => s + (Number(e.credit) || 0), 0);

  if (Math.abs(totalDebit - totalCredit) > 1e-6) {
    throwInvalidVoucher(
      `Debit and credit mismatch (debit ${totalDebit} ≠ credit ${totalCredit})`,
      "INVALID_VOUCHER",
      { totalDebit, totalCredit },
    );
  }

  let voucherNumber = voucherNumberIn != null && String(voucherNumberIn).trim()
    ? String(voucherNumberIn).trim()
    : null;
  if (!voucherNumber) {
    voucherNumber = await allocateVoucherNumber(session);
  }
  if (!voucherNumber || !String(voucherNumber).trim()) {
    throwInvalidVoucher("Voucher number allocation failed", "VOUCHER_NUMBER_FAILED");
  }

  const doc = {
    voucherNumber,
    type: normalizedType,
    narration,
    financialYearId,
    referenceType: referenceType ?? null,
    referenceId: referenceId ?? null,
    invoiceId: invoiceId ?? null,
    department: department ?? null,
    date: voucherDate,
    reversedFrom: reversedFrom ?? null,
  };

  let voucher;
  try {
    voucher = session
      ? (await Voucher.create([doc], { session }))[0]
      : await Voucher.create(doc);
  } catch (err) {
    if (err?.code === 11000) {
      throwInvalidVoucher("Duplicate voucher number or reference", "INVALID_VOUCHER", { cause: "duplicate" });
    }
    if (err?.name === "ValidationError") {
      throwInvalidVoucher(err.message || "Voucher validation failed", "INVALID_VOUCHER");
    }
    throwInvalidVoucher(err?.message || "Voucher could not be saved", "INVALID_VOUCHER");
  }

  let resolvedEntries;
  try {
    resolvedEntries = await Promise.all(
      entries.map(async (e) => ({
        voucherId: voucher._id,
        accountId: await getAccountIdByName(e.account),
        debit: Number(e.debit) || 0,
        credit: Number(e.credit) || 0,
      })),
    );
  } catch (err) {
    throwInvalidVoucher(err?.message || "Could not resolve GL accounts for voucher", "INVALID_VOUCHER");
  }

  let voucherEntries;
  try {
    voucherEntries = session
      ? await VoucherEntry.insertMany(resolvedEntries, { session })
      : await VoucherEntry.insertMany(resolvedEntries);
  } catch (err) {
    throwInvalidVoucher(err?.message || "Voucher lines could not be persisted", "INVALID_VOUCHER");
  }

  return { voucher, entries: voucherEntries };
}

async function markSourceReversedIfApplicable(voucher, session) {
  const rt = String(voucher.referenceType || "").toLowerCase();
  const rid = voucher.referenceId;
  if (!rid) return;
  const opts = session ? { session } : {};
  if (rt === "invoice") {
    await Invoice.findByIdAndUpdate(rid, { $set: { isReversed: true } }, opts);
  } else if (rt === "expense") {
    await Expense.findByIdAndUpdate(rid, { $set: { isReversed: true } }, opts);
  } else if (rt === "payment") {
    await Payment.findByIdAndUpdate(rid, { $set: { isReversed: true } }, opts);
  }
}

/**
 * Map expense category → GL expense account (fallback General Expense).
 */
function expenseAccountNameForCategory(category) {
  const c = String(category || "").toLowerCase().trim();
  if (c === "rent") return "Rent Expense";
  if (c === "salary") return "Salary Expense";
  if (c === "marketing") return "Marketing Expense";
  return "General Expense";
}

// ---------------------------------------------------------------------------
// Core engine
// ---------------------------------------------------------------------------

/**
 * createVoucher
 *
 * entries: Array<{ account: string, debit: number, credit: number }>
 *   `account` is a human-readable name — resolved to accountId automatically.
 */
async function createVoucher({
  type,
  narration = "",
  entries = [],
  financialYearId,
  referenceType = null,
  referenceId = null,
  invoiceId = null,
  department = null,
  reversedFrom = null,
  date = null,
  session = null,
}) {
  if (referenceType && referenceId) {
    const existing = await Voucher.findOne({ referenceType, referenceId }).session(session || null).lean();
    if (existing) {
      const existingEntries = await VoucherEntry.find({ voucherId: existing._id }).session(session || null).lean();
      return { voucher: existing, entries: existingEntries, alreadyExisted: true };
    }
  }

  return createValidatedVoucher({
    type,
    narration,
    entries,
    financialYearId,
    referenceType,
    referenceId,
    invoiceId,
    department,
    reversedFrom,
    date: date != null ? date : new Date(),
    session,
  });
}

/**
 * Post a reversing voucher (debit ↔ credit swapped) and mark the original as reversed.
 */
async function reverseVoucherById({ originalVoucherId, financialYearId }) {
  if (!financialYearId) {
    throw httpError("Active financial year is required", 400);
  }

  const session = await mongoose.startSession();
  let out = null;

  try {
    await session.withTransaction(async () => {
      const original = await Voucher.findById(originalVoucherId).session(session);
      if (!original) {
        throw httpError("Voucher not found", 404);
      }
      if (String(original.financialYearId) !== String(financialYearId)) {
        throw httpError("Voucher does not belong to the active financial year", 400);
      }
      if (original.isReversed) {
        throw httpError("Voucher already reversed", 400, "VOUCHER_ALREADY_REVERSED");
      }
      if (original.reversedFrom) {
        throw httpError("Cannot reverse a reversal voucher", 400, "CANNOT_REVERSE_REVERSAL");
      }
      const dup = await Voucher.findOne({ reversedFrom: original._id }).session(session).lean();
      if (dup) {
        throw httpError("Voucher already reversed", 400, "VOUCHER_ALREADY_REVERSED");
      }

      const rawEntries = await VoucherEntry.find({ voucherId: original._id })
        .session(session)
        .populate("accountId", "name");

      if (!rawEntries || rawEntries.length === 0) {
        throw httpError("Voucher has no entries to reverse", 400, "VOUCHER_NO_ENTRIES");
      }
      if (rawEntries.length < 2) {
        throw httpError(
          "Voucher has fewer than two entries; cannot post a valid reversing entry",
          400,
          "VOUCHER_ENTRIES_INSUFFICIENT",
        );
      }

      const swapEntries = rawEntries.map((e) => {
        const name = e.accountId?.name || "Unknown";
        return {
          account: name,
          debit:   Number(e.credit) || 0,
          credit:  Number(e.debit) || 0,
        };
      });

      const { voucher: reversal, entries: revEntries } = await createVoucher({
        type: original.type,
        narration: `Reversal — ${original.voucherNumber}${
          original.narration ? ` (${original.narration})` : ""
        }`,
        financialYearId,
        referenceType: null,
        referenceId: null,
        department: original.department ?? null,
        reversedFrom: original._id,
        entries: swapEntries,
        session,
      });

      await Voucher.findByIdAndUpdate(
        original._id,
        { $set: { isReversed: true, reversedByVoucherId: reversal._id } },
        { session },
      );

      await markSourceReversedIfApplicable(original, session);

      out = {
        originalVoucher: await Voucher.findById(original._id).session(session).lean(),
        reversal: {
          voucher: reversal.toObject(),
          entries: revEntries,
        },
      };
    });
  } finally {
    await session.endSession();
  }

  return out;
}

// ---------------------------------------------------------------------------
// Invoice → Voucher
// ---------------------------------------------------------------------------

async function createVoucherForInvoice({ invoice, financialYearId, session = null }) {
  const cgst = Number(invoice.cgst) || 0;
  const sgst = Number(invoice.sgst) || 0;
  const igst = Number(invoice.igst) || 0;
  const gstAmount  = cgst + sgst + igst;
  const baseAmount = Number(invoice.amount) || 0;

  const entries = [
    { account: "Accounts Receivable", debit: Number(invoice.totalAmount) || 0, credit: 0 },
    { account: "Revenue",             debit: 0, credit: baseAmount },
  ];
  if (gstAmount > 0) {
    entries.push({ account: "GST Payable", debit: 0, credit: gstAmount });
  }

  return createVoucher({
    type:          "sales",
    narration:     `Invoice created — Base ₹${baseAmount}, GST ₹${gstAmount}`,
    financialYearId,
    referenceType: "invoice",
    referenceId:   invoice._id,
    department:    invoice.department ?? null,
    entries,
    session,
  });
}

// ---------------------------------------------------------------------------
// Deferred Invoice → Voucher (Dr A/R, Cr Deferred Revenue, Cr GST Payable)
// ---------------------------------------------------------------------------

async function createVoucherForDeferredInvoice({ invoice, financialYearId, session = null }) {
  const cgst = Number(invoice.cgst) || 0;
  const sgst = Number(invoice.sgst) || 0;
  const igst = Number(invoice.igst) || 0;
  const gstAmount  = cgst + sgst + igst;
  const baseAmount = Number(invoice.amount) || 0;

  const entries = [
    { account: "Accounts Receivable", debit: Number(invoice.totalAmount) || 0, credit: 0 },
    { account: "Deferred Revenue",    debit: 0, credit: baseAmount },
  ];
  if (gstAmount > 0) {
    entries.push({ account: "GST Payable", debit: 0, credit: gstAmount });
  }

  return createVoucher({
    type:          "sales",
    narration:     `Deferred invoice — Base ₹${baseAmount}, GST ₹${gstAmount}`,
    financialYearId,
    referenceType: "invoice",
    referenceId:   invoice._id,
    department:    invoice.department ?? null,
    entries,
    session,
  });
}

// ---------------------------------------------------------------------------
// Payment → Voucher
// ---------------------------------------------------------------------------

/**
 * Validates payment voucher business rules before posting.
 *
 * **Reference model (required for multi partial payments per invoice):**
 * - `referenceType: "payment"` and `referenceId: payment._id` — unique per payment row.
 * - `invoiceId` on the voucher links to the invoice for reporting (do not use referenceId=invoiceId
 *   or the second payment on the same invoice would collide).
 *
 * **Entries:** Dr Cash or Bank (wallet), Cr Accounts Receivable.
 */
function validatePaymentVoucherPayload({ payment, financialYearId, invoiceId }) {
  if (!financialYearId) {
    const e = new Error("Active financial year is required");
    e.code = "FY_REQUIRED";
    throw e;
  }
  const amt = Number(payment?.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    const e = new Error("Payment amount must be a positive number");
    e.code = "PAYMENT_AMOUNT_INVALID";
    throw e;
  }
  const iid = payment?.invoiceId ?? invoiceId;
  if (!iid) {
    const e = new Error("invoiceId is required on payment for voucher posting");
    e.code = "INVOICE_ID_REQUIRED";
    throw e;
  }
  if (!mongoose.Types.ObjectId.isValid(String(iid))) {
    const e = new Error("Invalid invoice id for payment voucher");
    e.code = "INVOICE_ID_INVALID";
    throw e;
  }
}

async function createVoucherForPayment({
  payment,
  financialYearId,
  session = null,
  invoice = null,
}) {
  const linkedInvoiceId = payment.invoiceId ?? invoice?._id;
  validatePaymentVoucherPayload({ payment, financialYearId, invoiceId: linkedInvoiceId });

  const glCashBank = await glAccountNameForBankAccountId(payment.bankAccountId ?? null, session);
  const entries = [
    { account: glCashBank, debit: payment.amount, credit: 0 },
    { account: "Accounts Receivable", debit: 0, credit: payment.amount },
  ];
  if (!Array.isArray(entries) || entries.length < 2) {
    const e = new Error("Payment voucher must have at least two lines (Cash/Bank and Accounts Receivable)");
    e.code = "PAYMENT_VOUCHER_LINES";
    throw e;
  }

  return createVoucher({
    type: "payment",
    date: new Date(),
    narration: `Payment received — invoice ${String(linkedInvoiceId)} — ₹${payment.amount} via ${payment.method}`,
    financialYearId,
    referenceType: "payment",
    referenceId: payment._id,
    invoiceId: linkedInvoiceId,
    entries,
    session,
  });
}

async function createVoucherForPaymentReversal({ payment, financialYearId, session = null }) {
  const glCashBank = await glAccountNameForBankAccountId(payment.bankAccountId ?? null, session);
  return createVoucher({
    type:          "journal",
    narration:     `Payment reversal — ₹${payment.amount} (payment ${payment._id})`,
    financialYearId,
    referenceType: "payment_reversal",
    referenceId:   payment._id,
    entries: [
      { account: "Accounts Receivable", debit: payment.amount, credit: 0 },
      { account: glCashBank,          debit: 0, credit: payment.amount },
    ],
    session,
  });
}

// ---------------------------------------------------------------------------
// Expense → Voucher
// ---------------------------------------------------------------------------

async function createVoucherForExpense({ expense, financialYearId, session = null, bankAccountId = null }) {
  const tdsApplicable = Boolean(expense.tdsApplicable);
  const tdsAmount = tdsApplicable ? Number(expense.tdsAmount) || 0 : 0;
  const grossAmount = Number(expense.amount) || 0;
  const netAmount = Math.max(0, grossAmount - tdsAmount);
  const expenseGl = expenseAccountNameForCategory(expense.category);
  const opBankId = bankAccountId ?? expense.bankAccountId ?? null;
  const glCashBank = await glAccountNameForBankAccountId(opBankId, session);

  if (!tdsApplicable || tdsAmount <= 0) {
    return createVoucher({
      type:          "expense",
      narration:     `Expense — ${expense.title} ₹${expense.amount}`,
      financialYearId,
      referenceType: "expense",
      referenceId:   expense._id,
      department:    expense.department ?? null,
      entries: [
        { account: expenseGl,   debit: expense.amount, credit: 0 },
        { account: glCashBank,    debit: 0, credit: expense.amount },
      ],
      session,
    });
  }

  return createVoucher({
    type:          "expense",
    narration:     `Expense with TDS — ${expense.title} Gross ₹${grossAmount}, TDS ₹${tdsAmount}`,
    financialYearId,
    referenceType: "expense",
    referenceId:   expense._id,
    department:    expense.department ?? null,
    entries: [
      { account: expenseGl,     debit: grossAmount, credit: 0 },
      { account: glCashBank,      debit: 0, credit: netAmount },
      { account: "TDS Payable", debit: 0, credit: tdsAmount },
    ],
    session,
  });
}

async function createVoucherForTdsPayment({
  amount,
  financialYearId,
  referenceId = null,
  paymentAccount = "Cash",
  bankAccountId = null,
  session = null,
}) {
  const remittanceId = referenceId || new mongoose.Types.ObjectId();
  let glPay;
  if (bankAccountId) {
    glPay = await glAccountNameForBankAccountId(bankAccountId, session);
  } else {
    glPay = String(paymentAccount).toLowerCase() === "bank" ? "Bank" : "Cash";
  }
  return createVoucher({
    type:          "tds",
    narration:     `TDS payment — ₹${amount}`,
    financialYearId,
    referenceType: "tds_payment",
    referenceId:   remittanceId,
    entries: [
      { account: "TDS Payable", debit: amount, credit: 0 },
      { account: glPay, debit: 0, credit: amount },
    ],
    session,
  });
}

// ---------------------------------------------------------------------------
// Revenue recognition: Dr Deferred Revenue, Cr Revenue
// ---------------------------------------------------------------------------

async function createVoucherForRevenueRecognition({
  amount,
  narration,
  financialYearId,
  referenceType = "revenue_schedule",
  referenceId = null,
  session = null,
}) {
  return createVoucher({
    type:            "revenue",
    narration:       narration ?? `Revenue recognition — ₹${amount}`,
    financialYearId,
    referenceType,
    referenceId,
    entries: [
      { account: "Deferred Revenue", debit: amount, credit: 0 },
      { account: "Revenue",          debit: 0, credit: amount },
    ],
    session,
  });
}

module.exports = {
  createValidatedVoucher,
  createVoucher,
  createVoucherForInvoice,
  createVoucherForDeferredInvoice,
  createVoucherForRevenueRecognition,
  createVoucherForPayment,
  createVoucherForPaymentReversal,
  createVoucherForExpense,
  createVoucherForTdsPayment,
  expenseAccountNameForCategory,
  reverseVoucherById,
  validatePaymentVoucherPayload,
  VOUCHER_TYPES,
};
