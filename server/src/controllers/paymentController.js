const mongoose = require("mongoose");

const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const Voucher = require("../models/Voucher");
const { recordBankTransaction } = require("../services/bankService");
const { logAction, buildMetadata, ACTIONS } = require("../utils/audit");
const { createVoucherForPayment, createVoucherForPaymentReversal } = require("../services/voucherService");
const { assertPostTransactionAccountingInvariants } = require("../services/accountingInvariantsService");
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
    const userId = req.user?.sub ?? req.user?.id;
    const { invoiceId, amount, method, reference, bankAccountId } = req.body ?? {};

    if (!invoiceId || typeof invoiceId !== "string") {
      return res.status(400).json({ message: "invoiceId is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
      return res.status(400).json({ message: "invalid invoiceId" });
    }

    const parsedAmount = toNonNegativeNumber(amount);
    if (parsedAmount === null || parsedAmount <= 0) {
      return res.status(400).json({ message: "amount must be > 0" });
    }

    const normalizedMethod = normalizeMethod(method);
    if (!normalizedMethod || !["cash", "bank", "upi"].includes(normalizedMethod)) {
      return res.status(400).json({ message: "invalid payment method" });
    }

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const currentPaid =
      typeof invoice.paidAmount === "number" ? invoice.paidAmount : 0;
    const epsilon = 1e-6;
    const remainingRaw = invoice.totalAmount - currentPaid;
    const remaining = Math.max(0, remainingRaw);

    if (parsedAmount > remaining + epsilon) {
      return res.status(400).json({
        message: "Payment exceeds remaining amount",
        remaining,
      });
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

        await createVoucherForPayment({ payment, financialYearId, session, invoice });
        await recordBankTransaction({
          bankAccountId: bankRef ?? null,
          type: "credit",
          amount: parsedAmount,
          referenceType: "payment",
          referenceId: payment._id,
          session,
        });

        const paidAmount = currentPaid + parsedAmount;
        const newStatus =
          Math.abs(paidAmount - invoice.totalAmount) <= epsilon
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
    if (err?.code === "INVALID_VOUCHER" || err?.code === "VOUCHER_NUMBER_FAILED") {
      return sendStructuredError(res, {
        status: 400,
        code: "INVALID_VOUCHER",
        message: err.message || "Invalid voucher",
        action: ACTION.CONTACT_ADMIN,
      });
    }
    if (err?.code === "INSUFFICIENT_FUNDS") {
      return sendStructuredError(res, {
        status: 400,
        code: "INSUFFICIENT_FUNDS",
        message: err.message || "Insufficient funds",
        action: ACTION.RETRY,
      });
    }
    if (
      err?.code === "BANK_GL_BLOCK" ||
      err?.code === "ACCOUNTING_INVARIANT_BANK_GL" ||
      err?.code === "ACCOUNTING_INVARIANT_BALANCE_SHEET" ||
      err?.code === "ACCOUNTING_INVARIANT_NEGATIVE_BANK"
    ) {
      return sendStructuredError(res, {
        status: err.status || 503,
        code: err.code,
        message: err.message || "Accounting check failed",
        action: ACTION.RETRY,
        details: err.metrics,
      });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    return sendInternalError(res, err, { code: "PAYMENT_FAILED", action: ACTION.RETRY });
  }
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

