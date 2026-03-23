const mongoose = require("mongoose");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

const BankAccount = require("../models/BankAccount");
const BankTransaction = require("../models/BankTransaction");
const { recordBankTransaction } = require("../services/bankService");

function toPositiveNumber(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function createBankAccount(req, res) {
  try {
    const { name, accountNumber, balance } = req.body ?? {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "name is required" });
    }

    const startingBalance =
      balance === undefined || balance === null
        ? 0
        : typeof balance === "number"
          ? balance
          : Number(balance);

    if (!Number.isFinite(startingBalance)) {
      return res.status(400).json({ message: "balance must be a number" });
    }

    const created = await BankAccount.create({
      name: name.trim(),
      accountNumber:
        typeof accountNumber === "string" && accountNumber.trim()
          ? accountNumber.trim()
          : null,
      balance: startingBalance,
    });

    return res.status(201).json(created);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "DB_OPERATION_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function getBankAccounts(_req, res) {
  try {
    const accounts = await BankAccount.find().sort({ createdAt: -1 }).lean();
    return res.json(accounts);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "DB_OPERATION_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function createBankTransaction(req, res) {
  try {
    const { bankAccountId, type, amount, referenceType, referenceId } =
      req.body ?? {};

    if (!type) return res.status(400).json({ message: "type is required" });
    if (!referenceType) {
      return res.status(400).json({ message: "referenceType is required" });
    }

    const parsedAmount = toPositiveNumber(amount);
    if (parsedAmount === null) {
      return res.status(400).json({ message: "amount must be > 0" });
    }

    if (bankAccountId && !mongoose.Types.ObjectId.isValid(bankAccountId)) {
      return res.status(400).json({ message: "invalid bankAccountId" });
    }

    if (referenceId && !mongoose.Types.ObjectId.isValid(referenceId)) {
      return res.status(400).json({ message: "invalid referenceId" });
    }

    const tx = await recordBankTransaction({
      bankAccountId: bankAccountId ?? null,
      type,
      amount: parsedAmount,
      referenceType,
      referenceId: referenceId ?? null,
    });

    return res.status(201).json(tx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong";
    if (
      typeof msg === "string" &&
      (msg.includes("not found") ||
        msg.includes("invalid") ||
        msg.includes("amount") ||
        msg.includes("negative cash") ||
        msg.includes("negative cash or bank"))
    ) {
      return res.status(400).json({ message: msg });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "BANK_OPERATION_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function getBankTransactions(req, res) {
  try {
    const { bankAccountId } = req.query ?? {};

    const filter = {};
    if (typeof bankAccountId === "string" && bankAccountId.trim()) {
      if (!mongoose.Types.ObjectId.isValid(bankAccountId)) {
        return res.status(400).json({ message: "invalid bankAccountId" });
      }
      filter.bankAccountId = bankAccountId;
    }

    const txs = await BankTransaction.find(filter)
      .sort({ date: -1 })
      .populate("bankAccountId")
      .lean();
    return res.json(txs);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "DB_OPERATION_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function markBankTransactionsReconciled(req, res) {
  try {
    const { transactionIds } = req.body ?? {};
    const ids = Array.isArray(transactionIds) ? transactionIds : [];

    if (ids.length === 0) {
      return res.status(400).json({ message: "transactionIds array is required" });
    }

    const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
    if (validIds.length === 0) {
      return res.status(400).json({ message: "No valid transaction IDs provided" });
    }

    const result = await BankTransaction.updateMany(
      { _id: { $in: validIds } },
      { $set: { isReconciled: true } }
    );

    return res.json({
      message: "Transactions marked as reconciled",
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "BANK_RECONCILE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

module.exports = {
  createBankAccount,
  getBankAccounts,
  createBankTransaction,
  getBankTransactions,
  markBankTransactionsReconciled,
};

