const RevenueSchedule = require("../models/RevenueSchedule");
const Invoice = require("../models/Invoice");
const mongoose = require("mongoose");
const { createVoucherForRevenueRecognition } = require("../services/voucherService");
const { logAction, buildMetadata, ACTIONS } = require("../utils/audit");
const { buildAccountMap, resolveFilter } = require("../controllers/reportController");
const { assertPostTransactionAccountingInvariants } = require("../services/accountingInvariantsService");
const { sendInternalError, ACTION } = require("../utils/httpErrorResponse");

/**
 * POST /api/revenue/recognize
 *
 * Find due schedules (date <= today), mark isRecognized = true,
 * create voucher: Dr Deferred Revenue, Cr Revenue
 */
async function recognizeRevenue(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const financialYearId = req.activeYear?._id ?? null;

    if (!financialYearId) {
      return res.status(400).json({
        message: "Active financial year is required for revenue recognition",
      });
    }

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const dueSchedules = await RevenueSchedule.find({
      isRecognized: false,
      date: { $lte: today },
    })
      .sort({ date: 1 })
      .lean();

    if (dueSchedules.length === 0) {
      return res.status(404).json({
        message: "No due revenue schedules to recognize",
        code: "NO_DUE_REVENUE_SCHEDULES",
      });
    }

    const totalAmount = dueSchedules.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    const { voucherIds, financialYearId: fyId } = await resolveFilter({ financialYearId });
    const map = await buildAccountMap(voucherIds, fyId);
    const deferredRow = [...map.values()].find((r) => r.account === "Deferred Revenue");
    const deferredBalance = deferredRow
      ? (Number(deferredRow.credit) || 0) - (Number(deferredRow.debit) || 0)
      : 0;
    if (deferredBalance < -0.01) {
      return res.status(400).json({
        message: "Deferred revenue balance is negative — invalid state",
        code: "INVALID_DEFERRED_STATE",
      });
    }
    if (totalAmount > deferredBalance + 0.01) {
      return res.status(400).json({
        message: "Recognition amount exceeds deferred revenue balance",
        code: "RECOGNITION_EXCEEDS_DEFERRED",
      });
    }

    const invoiceIds = [...new Set(dueSchedules.map((s) => String(s.invoiceId)))];
    const invoices = await Invoice.find({ _id: { $in: invoiceIds } })
      .select("_id amount recognizedRevenue")
      .lean();
    const invMap = new Map(invoices.map((i) => [String(i._id), i]));
    for (const invId of invoiceIds) {
      const inv = invMap.get(invId);
      if (!inv) continue;
      const invScheduleAmount = dueSchedules
        .filter((s) => String(s.invoiceId) === invId)
        .reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const available = Number(inv.amount) - (Number(inv.recognizedRevenue) || 0);
      if (invScheduleAmount > available + 0.01) {
        return res.status(400).json({
          message: `Recognition exceeds available deferred balance for invoice`,
          code: "RECOGNITION_EXCEEDS_DEFERRED",
        });
      }
    }

    const scheduleIds = dueSchedules.map((s) => s._id);
    const session = await mongoose.startSession();
    let voucher = null;

    try {
      await session.withTransaction(async () => {
        const result = await createVoucherForRevenueRecognition({
          amount: totalAmount,
          narration: `Revenue recognition — ${dueSchedules.length} schedule(s), ₹${totalAmount.toFixed(2)}`,
          financialYearId,
          referenceType: "revenue_schedule",
          referenceId: scheduleIds[0],
          session,
        });
        if (result?.alreadyExisted) {
          const e = new Error("Revenue recognition already posted (voucher exists for this reference)");
          e.code = "ALREADY_PROCESSED";
          throw e;
        }
        voucher = result?.voucher ?? result;
        await RevenueSchedule.updateMany(
          { _id: { $in: scheduleIds } },
          { $set: { isRecognized: true } },
          { session },
        );
        for (const invId of invoiceIds) {
          const invSchedules = dueSchedules.filter((s) => String(s.invoiceId) === invId);
          const invAmount = invSchedules.reduce((s, r) => s + (Number(r.amount) || 0), 0);
          await Invoice.updateOne(
            { _id: invId },
            { $inc: { recognizedRevenue: invAmount } },
            { session },
          );
        }
        await assertPostTransactionAccountingInvariants(financialYearId, session);
      });
    } finally {
      await session.endSession();
    }

    await logAction(userId, ACTIONS.CREATE, "revenue_schedule", scheduleIds[0], buildMetadata(null, {
      scheduleCount: dueSchedules.length,
      amount:        totalAmount,
      voucherId:     voucher._id?.toString?.(),
    }));

    return res.status(201).json({
      message:    "Revenue recognized",
      recognized: totalAmount,
      scheduleCount: dueSchedules.length,
      voucherId:  voucher._id,
    });
  } catch (err) {
    if (err?.code === "ALREADY_PROCESSED") {
      return res.status(409).json({ message: err.message, code: "ALREADY_PROCESSED" });
    }
    if (
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
    // eslint-disable-next-line no-console
    console.error(err);
    return sendInternalError(res, err, { code: "REVENUE_RECOGNIZE_FAILED", action: ACTION.RETRY });
  }
}

/**
 * GET /api/revenue/schedules
 * List schedules, optionally filtered by invoiceId
 */
async function getSchedules(req, res) {
  try {
    const { invoiceId } = req.query ?? {};

    const filter = {};
    if (invoiceId && mongoose.Types.ObjectId.isValid(invoiceId)) {
      filter.invoiceId = invoiceId;
    }

    const schedules = await RevenueSchedule.find(filter)
      .populate("invoiceId", "amount totalAmount isDeferred deferredMonths recognizedRevenue")
      .sort({ date: 1 })
      .lean();

    return res.json(schedules);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendInternalError(res, err, { code: "REVENUE_SCHEDULES_FAILED", action: ACTION.RETRY });
  }
}

module.exports = { recognizeRevenue, getSchedules };
