const mongoose = require("mongoose");

const BankAccount = require("../models/BankAccount");
const BankTransaction = require("../models/BankTransaction");

const { insufficientFunds } = require("../utils/prodErrors");

/** Always false in production: negative cash is disabled. Debits that would reduce balance below zero throw INSUFFICIENT_FUNDS. */
function allowNegativeCash() {
  return false;
}

async function getOrCreateCashAccount(session) {
  const s = session ?? null;
  const existing = await BankAccount.findOne({ name: "Cash" }).session(s).exec();
  if (existing) return existing;

  const created = await BankAccount.create(
    [{ name: "Cash", accountNumber: "CASH", balance: 0 }],
    s ? { session: s } : {},
  );
  return Array.isArray(created) ? created[0] : created;
}

/**
 * Record a bank transaction. Concurrency-safe: debits use atomic findOneAndUpdate
 * so no race conditions. Pass session to participate in a parent transaction.
 */
async function recordBankTransaction({
  bankAccountId,
  type,
  amount,
  referenceType,
  referenceId,
  session: parentSession = null,
}) {
  const parsedAmount = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new Error("amount must be a valid number > 0");
  }

  const normalizedType = String(type).toLowerCase();
  if (!["credit", "debit"].includes(normalizedType)) {
    throw new Error("invalid type");
  }

  const normalizedReferenceType = String(referenceType || "").toLowerCase();
  const allowedRefs = ["payment", "expense", "manual", "tds_payment", "payroll"];
  if (!normalizedReferenceType || !allowedRefs.includes(normalizedReferenceType)) {
    throw new Error("invalid referenceType");
  }

  const runInTransaction = async (s) => {
    const account = bankAccountId
      ? await BankAccount.findById(bankAccountId).session(s).exec()
      : await getOrCreateCashAccount(s);

    if (!account) {
      throw new Error("Bank account not found");
    }

    if (normalizedType === "debit") {
      const updated = await BankAccount.findOneAndUpdate(
        { _id: account._id, balance: { $gte: parsedAmount } },
        { $inc: { balance: -parsedAmount } },
        { session: s, returnDocument: "after" },
      );
      if (!updated) {
        throw insufficientFunds();
      }
    } else {
      await BankAccount.updateOne(
        { _id: account._id },
        { $inc: { balance: parsedAmount } },
        { session: s },
      );
    }

    const [tx] = await BankTransaction.create(
      [
        {
          bankAccountId: account._id,
          type: normalizedType,
          amount: parsedAmount,
          referenceType: normalizedReferenceType,
          referenceId: referenceId ?? null,
          date: new Date(),
        },
      ],
      { session: s },
    );
    return tx;
  };

  if (parentSession) {
    return runInTransaction(parentSession);
  }

  const session = await mongoose.startSession();
  try {
    let result = null;
    await session.withTransaction(async () => {
      result = await runInTransaction(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}

/**
 * Map operational BankAccount → GL account name ("Cash" or "Bank").
 * Single GL "Bank" bucket for all non-Cash bank accounts (matches system validation).
 */
async function glAccountNameForBankAccountId(bankAccountId, session = null) {
  if (!bankAccountId) {
    const cash = await getOrCreateCashAccount(session);
    return cash.name === "Cash" ? "Cash" : "Bank";
  }
  const acc = await BankAccount.findById(bankAccountId).session(session).exec();
  if (!acc) {
    throw new Error("Bank account not found");
  }
  return acc.name === "Cash" ? "Cash" : "Bank";
}

module.exports = { recordBankTransaction, allowNegativeCash, glAccountNameForBankAccountId };

