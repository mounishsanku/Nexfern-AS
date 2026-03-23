const mongoose = require("mongoose");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

const BankStatement = require("../models/BankStatement");
const Payment = require("../models/Payment");
const Expense = require("../models/Expense");
const { buildAccountMap, resolveFilter, round } = require("./reportController");

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

function normalizeType(type) {
  return typeof type === "string" ? type.toLowerCase().trim() : "";
}

function toAmount(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

function parseCsvPayload(csvText) {
  const lines = String(csvText)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const iDate = header.indexOf("date");
  const iDesc = header.indexOf("description");
  const iAmount = header.indexOf("amount");
  const iType = header.indexOf("type");
  if ([iDate, iDesc, iAmount, iType].some((idx) => idx < 0)) {
    throw new Error("CSV header must include date,description,amount,type");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    rows.push({
      date: cols[iDate],
      description: cols[iDesc],
      amount: cols[iAmount],
      type: cols[iType],
    });
  }
  return rows;
}

function getConfidenceScore(bankDate, systemDate) {
  const diffMs = Math.abs(new Date(systemDate).getTime() - new Date(bankDate).getTime());
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 100;
  if (diffDays === 1) return 80;
  return 60;
}

async function uploadBankTransactions(req, res) {
  try {
    let payload = req.body;
    const isCsv = typeof req.body === "string";
    if (isCsv) {
      payload = parseCsvPayload(req.body);
    }

    if (!Array.isArray(payload) || payload.length === 0) {
      return res.status(400).json({ message: "Request body must be a non-empty array" });
    }

    const docs = [];
    for (const row of payload) {
      const amount = toAmount(row?.amount);
      const type = normalizeType(row?.type);
      const date = row?.date ? new Date(row.date) : new Date();

      if (amount === null || amount < 0) {
        return res.status(400).json({ message: "amount must be a non-negative number" });
      }
      if (!["credit", "debit"].includes(type)) {
        return res.status(400).json({ message: "type must be credit or debit" });
      }
      if (Number.isNaN(date.getTime())) {
        return res.status(400).json({ message: "invalid date" });
      }

      docs.push({
        date,
        description: typeof row?.description === "string" ? row.description.trim() : "",
        amount,
        type,
        isMatched: false,
      });
    }

    const inserted = await BankStatement.insertMany(docs);
    return res.status(201).json(inserted);
  } catch (err) {
    console.error(err);
    return sendStructuredError(res, {
      code: "BANK_RECONCILIATION_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function reconcileBankTransactions(req, res) {
  try {
    const [bankRows, payments, expenses] = await Promise.all([
      BankStatement.find({ isMatched: false }).sort({ date: 1 }).lean(),
      Payment.find({ $or: [{ matched: false }, { matched: { $exists: false } }] })
        .sort({ date: 1 })
        .lean(),
      Expense.find({
        status: "approved",
        $or: [{ matched: false }, { matched: { $exists: false } }],
      })
        .sort({ date: 1 })
        .lean(),
    ]);

    const matched = [];
    const unmatched = [];
    const usedPaymentIds = new Set();
    const usedExpenseIds = new Set();

    for (const bankTx of bankRows) {
      let matchedSource = null;

      if (bankTx.type === "credit") {
        for (const payment of payments) {
          const paymentId = String(payment._id);
          if (usedPaymentIds.has(paymentId)) continue;

          const sameAmount = Number(payment.amount) === Number(bankTx.amount);
          const withinDateWindow =
            Math.abs(new Date(payment.date).getTime() - new Date(bankTx.date).getTime()) <=
            TWO_DAYS_MS;

          if (sameAmount && withinDateWindow) {
            matchedSource = { sourceType: "payment", row: payment };
            usedPaymentIds.add(paymentId);
            break;
          }
        }
      } else if (bankTx.type === "debit") {
        for (const expense of expenses) {
          const expenseId = String(expense._id);
          if (usedExpenseIds.has(expenseId)) continue;

          const sameAmount = Number(expense.amount) === Number(bankTx.amount);
          const withinDateWindow =
            Math.abs(new Date(expense.date).getTime() - new Date(bankTx.date).getTime()) <=
            TWO_DAYS_MS;

          if (sameAmount && withinDateWindow) {
            matchedSource = { sourceType: "expense", row: expense };
            usedExpenseIds.add(expenseId);
            break;
          }
        }
      }

      if (matchedSource) {
        const confidenceScore = getConfidenceScore(bankTx.date, matchedSource.row.date);
        const matchedBy = req.user?.sub ?? req.user?.id ?? null;
        const matchedAt = new Date();
        if (matchedSource.sourceType === "payment") {
          await Promise.all([
            BankStatement.updateOne(
              { _id: bankTx._id },
              {
                $set: {
                  isMatched: true,
                  matchedBy,
                  matchedAt,
                  matchedReferenceType: "payment",
                  matchedReferenceId: matchedSource.row._id,
                },
              },
            ),
            Payment.updateOne({ _id: matchedSource.row._id }, { $set: { matched: true } }),
          ]);
          matched.push({
            bankTransaction: {
              ...bankTx,
              isMatched: true,
              matchedBy,
              matchedAt,
              matchedReferenceType: "payment",
              matchedReferenceId: matchedSource.row._id,
            },
            sourceType: "payment",
            payment: { ...matchedSource.row, matched: true },
            confidenceScore,
          });
        } else {
          await Promise.all([
            BankStatement.updateOne(
              { _id: bankTx._id },
              {
                $set: {
                  isMatched: true,
                  matchedBy,
                  matchedAt,
                  matchedReferenceType: "expense",
                  matchedReferenceId: matchedSource.row._id,
                },
              },
            ),
            Expense.updateOne({ _id: matchedSource.row._id }, { $set: { matched: true } }),
          ]);
          matched.push({
            bankTransaction: {
              ...bankTx,
              isMatched: true,
              matchedBy,
              matchedAt,
              matchedReferenceType: "expense",
              matchedReferenceId: matchedSource.row._id,
            },
            sourceType: "expense",
            expense: { ...matchedSource.row, matched: true },
            confidenceScore,
          });
        }
      } else {
        unmatched.push(bankTx);
      }
    }

    matched.sort(
      (a, b) =>
        new Date(a.bankTransaction.date).getTime() - new Date(b.bankTransaction.date).getTime(),
    );
    unmatched.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const totalBankAmount = round2(bankRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
    const matchedAmount = round2(
      matched.reduce((sum, row) => sum + (Number(row.bankTransaction.amount) || 0), 0),
    );
    const unmatchedAmount = round2(
      unmatched.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    );
    const difference = round2(totalBankAmount - matchedAmount);
    const { voucherIds, financialYearId } = await resolveFilter({});
    const accountMap = await buildAccountMap(voucherIds, financialYearId);
    let ledgerBalance = 0;
    for (const row of accountMap.values()) {
      const name = String(row.account || "").toLowerCase();
      if (row.type === "asset" && (name === "cash" || name.includes("bank"))) {
        ledgerBalance += Number(row.balance) || 0;
      }
    }
    ledgerBalance = round(ledgerBalance);
    const bankBalance = totalBankAmount;
    const balanceDifference = round2(bankBalance - ledgerBalance);

    return res.json({
      summary: {
        totalBankAmount,
        matchedAmount,
        unmatchedAmount,
        difference,
        ledgerBalance,
        bankBalance,
        balanceDifference,
      },
      matched,
      unmatched,
    });
  } catch (err) {
    console.error(err);
    return sendStructuredError(res, {
      code: "BANK_RECONCILIATION_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function manualMatchBankTransaction(req, res) {
  try {
    const { bankTransactionId, paymentId } = req.body ?? {};
    if (!mongoose.Types.ObjectId.isValid(bankTransactionId)) {
      return res.status(400).json({ message: "invalid bankTransactionId" });
    }
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({ message: "invalid paymentId" });
    }

    const [bankTx, payment] = await Promise.all([
      BankStatement.findById(bankTransactionId),
      Payment.findById(paymentId),
    ]);

    if (!bankTx) return res.status(404).json({ message: "Bank transaction not found" });
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (bankTx.isMatched) {
      return res.status(400).json({ message: "Bank statement line is already matched" });
    }
    if (payment.matched) {
      return res.status(400).json({ message: "Payment is already matched to a bank line" });
    }

    const existingForPayment = await BankStatement.findOne({
      isMatched: true,
      matchedReferenceType: "payment",
      matchedReferenceId: payment._id,
      _id: { $ne: bankTx._id },
    }).lean();
    if (existingForPayment) {
      return res.status(400).json({
        message: "Payment is already matched to another bank statement line",
      });
    }

    const matchedBy = req.user?.sub ?? req.user?.id ?? null;
    const matchedAt = new Date();
    await Promise.all([
      BankStatement.updateOne(
        { _id: bankTx._id },
        {
          $set: {
            isMatched: true,
            matchedBy,
            matchedAt,
            matchedReferenceType: "payment",
            matchedReferenceId: payment._id,
          },
        },
      ),
      Payment.updateOne({ _id: payment._id }, { $set: { matched: true } }),
    ]);

    return res.json({
      bankTransaction: {
        ...bankTx.toObject(),
        isMatched: true,
        matchedBy,
        matchedAt,
        matchedReferenceType: "payment",
        matchedReferenceId: payment._id,
      },
      payment: { ...payment.toObject(), matched: true },
    });
  } catch (err) {
    console.error(err);
    return sendStructuredError(res, {
      code: "BANK_RECONCILIATION_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function unmatchBankTransaction(req, res) {
  try {
    const { bankTransactionId } = req.body ?? {};
    if (!mongoose.Types.ObjectId.isValid(bankTransactionId)) {
      return res.status(400).json({ message: "invalid bankTransactionId" });
    }

    const bankTx = await BankStatement.findById(bankTransactionId).lean();
    if (!bankTx) return res.status(404).json({ message: "Bank transaction not found" });

    if (bankTx.matchedReferenceType === "payment" && bankTx.matchedReferenceId) {
      await Payment.updateOne({ _id: bankTx.matchedReferenceId }, { $set: { matched: false } });
    }
    if (bankTx.matchedReferenceType === "expense" && bankTx.matchedReferenceId) {
      await Expense.updateOne({ _id: bankTx.matchedReferenceId }, { $set: { matched: false } });
    }

    await BankStatement.updateOne(
      { _id: bankTx._id },
      {
        $set: {
          isMatched: false,
          matchedBy: null,
          matchedAt: null,
          matchedReferenceType: null,
          matchedReferenceId: null,
        },
      },
    );

    return res.json({ message: "Transaction unmatched successfully" });
  } catch (err) {
    console.error(err);
    return sendStructuredError(res, {
      code: "BANK_RECONCILIATION_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

module.exports = {
  uploadBankTransactions,
  reconcileBankTransactions,
  manualMatchBankTransaction,
  unmatchBankTransaction,
};
