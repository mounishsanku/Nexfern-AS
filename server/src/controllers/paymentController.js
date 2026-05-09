const mongoose = require("mongoose");

const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const Voucher = require("../models/Voucher");
const { recordBankTransaction, glAccountNameForBankAccountId } = require("../services/bankService");
const { logAction, buildMetadata, ACTIONS } = require("../utils/audit");
const { createValidatedVoucher, createVoucherForPaymentReversal } = require("../services/voucherService");
const { assertPostTransactionAccountingInvariants } = require("../services/accountingInvariantsService");
const { allocateVoucherNumber } = require("../services/voucherNumberService");
const { validateAndHealBeforeTransaction } = require("../services/systemHealService");
const { sendInternalError, sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

function toNonNegativeNumber(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeMethod(method) {
  return typeof method === "string" ? method.toLowerCase().trim() : null;
}

async function createPayment(req, res) {
  try {
    // eslint-disable-next-line no-console
    console.log("Payment request:", req.body);
    const userId = req.user?.sub ?? req.user?.id;
    const { invoiceId, amount, method, reference, bankAccountId } = req.body ?? {};

    const invalidPayment = () =>
      sendStructuredError(res, {
        status: 400,
        code: "INVALID_PAYMENT",
        message: "Invalid payment input",
        action: ACTION.FIX_REQUIRED,
      });

    if (!invoiceId || typeof invoiceId !== "string") {
      return invalidPayment();
    }
    if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
      return invalidPayment();
    }

    const parsedAmount = toNonNegativeNumber(amount);
    if (parsedAmount === null || parsedAmount <= 0) {
      return invalidPayment();
    }

    const normalizedMethod = normalizeMethod(method);
    if (!normalizedMethod || !["cash", "bank", "upi"].includes(normalizedMethod)) {
      return invalidPayment();
    }

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return invalidPayment();
    }

    const currentPaid =
      typeof invoice.paidAmount === "number" ? invoice.paidAmount : 0;
    const epsilon = 1e-6;
    const remainingRaw = invoice.totalAmount - currentPaid;
    const remaining = Math.max(0, remainingRaw);

    if (parsedAmount > remaining + epsilon) {
      return invalidPayment();
    }

    const financialYearId = req.activeYear?._id ?? null;
    await validateAndHealBeforeTransaction(financialYearId);

    const session = await mongoose.startSession();
    let payment = null;

    try {
      await session.withTransaction(async () => {
        const bankRef =
          bankAccountId && mongoose.Types.ObjectId.isValid(String(bankAccountId))
            ? bankAccountId
            : null;

        // Re-read invoice inside the transaction to reduce race-condition risk.
        const invoiceDoc = await Invoice.findById(invoiceId).session(session);
        if (!invoiceDoc) throwInvalidPaymentInputError();
        const txCurrentPaid =
          typeof invoiceDoc.paidAmount === "number" ? invoiceDoc.paidAmount : 0;
        const txRemaining = Math.max(0, (invoiceDoc.totalAmount ?? 0) - txCurrentPaid);
        if (parsedAmount > txRemaining + epsilon) throwInvalidPaymentInputError();

        payment = await Payment.create(
          [
            {
              invoiceId,
              amount: parsedAmount,
              method: normalizedMethod,
              reference:
                typeof reference === "string" && reference.trim()
                  ? reference.trim()
                  : null,
              bankAccountId: bankRef,
              financialYearId,
              date: new Date(),
            },
          ],
          { session }
        );
        payment = payment[0];

        // -------------------------------------------------------------------
        // Voucher creation (strict payload validation)
        // -------------------------------------------------------------------
        const glCashBank = await glAccountNameForBankAccountId(bankRef ?? null, session);
        const voucherNumber = await allocateVoucherNumber(session);

        const voucherPayload = {
          type: "payment",
          date: new Date(),
          voucherNumber,
          entries: [
            { account: glCashBank, debit: parsedAmount, credit: 0 },
            { account: "Accounts Receivable", debit: 0, credit: parsedAmount },
          ],
        };

        if (!Array.isArray(voucherPayload.entries) || voucherPayload.entries.length < 2) {
          const e = new Error("INVALID_VOUCHER: voucher payload entries insufficient");
          e.code = "INVALID_VOUCHER";
          throw e;
        }

        const totalDebit = voucherPayload.entries.reduce((s, e) => s + (Number(e.debit) || 0), 0);
        const totalCredit = voucherPayload.entries.reduce((s, e) => s + (Number(e.credit) || 0), 0);
        if (Math.abs(totalDebit - totalCredit) > 1e-6) {
          const e = new Error(`INVALID_VOUCHER: debit ${totalDebit} != credit ${totalCredit}`);
          e.code = "INVALID_VOUCHER";
          throw e;
        }

        await createValidatedVoucher({
          ...voucherPayload,
          financialYearId,
          narration: `Payment received — invoice ${String(invoiceDoc._id)} — ₹${parsedAmount} via ${normalizedMethod}`,
          referenceType: "payment",
          referenceId: payment._id,
          invoiceId: invoiceDoc._id,
          session,
        });

        await recordBankTransaction({
          bankAccountId: bankRef ?? null,
          type: "credit",
          amount: parsedAmount,
          referenceType: "payment",
          referenceId: payment._id,
          session,
        });

        const paidAmount = txCurrentPaid + parsedAmount;
        const newStatus =
          Math.abs(paidAmount - (invoiceDoc.totalAmount ?? 0)) <= epsilon
            ? "paid"
            : paidAmount > 0
              ? "partial"
              : "unpaid";

        await Invoice.updateOne(
          { _id: invoiceId },
          { $set: { paidAmount, status: newStatus } },
          { session },
        );
        await assertPostTransactionAccountingInvariants(financialYearId, session);
      });
    } finally {
      await session.endSession();
    }

    const paidAmount = currentPaid + parsedAmount;

    await logAction(userId, ACTIONS.CREATE, "payment", payment._id, buildMetadata(null, {
      invoiceId,
      amount: parsedAmount,
      method: normalizedMethod,
      reference: payment.reference ?? null,
      date: payment.date,
    }));

    return res.status(201).json(payment);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("PAYMENT ERROR:", err);

    if (err?.code === "INVALID_PAYMENT_INPUT") {
      return sendStructuredError(res, {
        status: 400,
        code: "INVALID_PAYMENT",
        message: "Invalid payment input",
        action: ACTION.FIX_REQUIRED,
      });
    }

    return sendStructuredError(res, {
      status: 503,
      code: "PAYMENT_FAILED",
      message: "Payment could not be processed",
      action: ACTION.RETRY,
    });
  }
}

function throwInvalidPaymentInputError() {
  const e = new Error("Invalid payment input");
  e.code = "INVALID_PAYMENT_INPUT";
  throw e;
}

async function updatePayment(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const { id } = req.params ?? {};
    const { reference } = req.body ?? {};

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid payment id" });
    }

    const payment = await Payment.findById(id).lean();
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (payment.matched) {
      return res.status(403).json({
        message: "Payment is reconciled and cannot be updated",
        code: "RECORD_IMMUTABLE",
      });
    }

    const newRef = typeof reference === "string" ? (reference.trim() || null) : payment.reference;

    const before = { reference: payment.reference ?? null };
    const updated = await Payment.findByIdAndUpdate(
      id,
      { $set: { reference: newRef } },
      { new: true },
    ).lean();

    await logAction(userId, ACTIONS.UPDATE, "payment", id, buildMetadata(before, { reference: updated.reference }));

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return sendInternalError(res, err, { code: "PAYMENT_FAILED", action: ACTION.RETRY });
  }
}

async function deletePayment(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const { id } = req.params ?? {};

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid payment id" });
    }

    const payment = await Payment.findById(id);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (payment.matched) {
      return res.status(403).json({
        message: "Payment is reconciled and cannot be deleted",
        code: "RECORD_IMMUTABLE",
      });
    }

    const posted = await Voucher.findOne({ referenceType: "payment", referenceId: payment._id }).lean();
    if (posted) {
      return res.status(403).json({
        message: "Cannot delete payment with posted voucher",
        code: "RECORD_IMMUTABLE",
      });
    }

    const invoice = await Invoice.findById(payment.invoiceId);
    if (!invoice) return res.status(400).json({ message: "Invoice not found" });

    const amount = payment.amount;
    const financialYearId = req.activeYear?._id ?? invoice.financialYearId;

    const before = {
      invoiceId: payment.invoiceId?.toString?.(),
      amount: payment.amount,
      method: payment.method,
    };

    // Reversal voucher
    try {
      await createVoucherForPaymentReversal({ payment, financialYearId });
    } catch (_e) {
      console.warn("Reversal voucher failed:", _e.message);
    }

    // Update invoice paidAmount and status
    const newPaid = Math.max(0, (invoice.paidAmount ?? 0) - amount);
    const epsilon = 1e-6;
    const newStatus =
      Math.abs(newPaid - invoice.totalAmount) <= epsilon ? "paid"
        : newPaid > 0 ? "partial"
          : "unpaid";
    await Invoice.findByIdAndUpdate(payment.invoiceId, {
      $set: { paidAmount: newPaid, status: newStatus },
    });

    await Payment.findByIdAndDelete(id);

    await logAction(userId, ACTIONS.DELETE, "payment", id, buildMetadata(before, null));

    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return sendInternalError(res, err, { code: "PAYMENT_FAILED", action: ACTION.RETRY });
  }
}

async function getPayments(req, res) {
  try {
    const { invoiceId, id } = req.params ?? {};
    const targetInvoiceId = invoiceId ?? id;

    if (!targetInvoiceId || typeof targetInvoiceId !== "string") {
      return res.status(400).json({ message: "invoiceId is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(targetInvoiceId)) {
      return res.status(400).json({ message: "invalid invoiceId" });
    }

    const payments = await Payment.find({ invoiceId: targetInvoiceId })
      .sort({ date: -1 })
      .lean();

    return res.json(payments);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendInternalError(res, err, { code: "PAYMENT_FAILED", action: ACTION.RETRY });
  }
}

module.exports = { createPayment, getPayments, updatePayment, deletePayment };

