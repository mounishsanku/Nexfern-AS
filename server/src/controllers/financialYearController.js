const mongoose  = require("mongoose");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");
const FinancialYear  = require("../models/FinancialYear");
const VoucherEntry   = require("../models/VoucherEntry");
const Voucher        = require("../models/Voucher");
const { carryForward } = require("./openingBalanceController");

// ─── Create Year ──────────────────────────────────────────────────────────────

async function createYear(req, res) {
  try {
    const { name, startDate, endDate } = req.body ?? {};

    if (!name || typeof name !== "string") {
      return res.status(400).json({ message: "name is required" });
    }

    const start = new Date(startDate);
    const end   = new Date(endDate);
    if (isNaN(start) || isNaN(end) || start >= end) {
      return res.status(400).json({ message: "Valid startDate and endDate are required" });
    }

    const existing = await FinancialYear.findOne({ isClosed: false });
    if (existing) {
      return res.status(400).json({
        message: `An active financial year already exists: ${existing.name}`,
        activeYear: existing,
      });
    }

    const year = await FinancialYear.create({ name, startDate: start, endDate: end });

    // Carry forward closing balances from the most recently closed year
    const prevYear = await FinancialYear.findOne({ isClosed: true })
      .sort({ endDate: -1 })
      .lean();

    if (prevYear) {
      await carryForward(String(prevYear._id), String(year._id));
    }

    return res.status(201).json(year);
  } catch (err) {
    console.error("createYear error:", err);
    return sendStructuredError(res, {
      code: "FY_CREATE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ─── List Years ───────────────────────────────────────────────────────────────

async function listYears(_req, res) {
  try {
    const years = await FinancialYear.find().sort({ startDate: -1 }).lean();
    return res.json(years);
  } catch (err) {
    console.error("listYears error:", err);
    return sendStructuredError(res, {
      code: "FY_LIST_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ─── Close Year ───────────────────────────────────────────────────────────────

async function closeYear(req, res) {
  try {
    const { id } = req.params ?? {};
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid year id" });
    }

    const year = await FinancialYear.findById(id);
    if (!year)          return res.status(404).json({ message: "Financial year not found" });
    if (year.isClosed)  return res.status(400).json({ message: "Year is already closed" });

    // Calculate P&L from VoucherEntry for this year
    const vouchers = await Voucher.find({ financialYearId: id }).select("_id").lean();
    const voucherIds = vouchers.map((v) => v._id);

    const entries = await VoucherEntry.find({ voucherId: { $in: voucherIds } })
      .populate({ path: "accountId", select: "name type" })
      .lean();

    let revenue = 0, expense = 0;
    for (const e of entries) {
      if (!e.accountId) continue;
      if (e.accountId.type === "revenue") revenue += Number(e.credit) - Number(e.debit);
      if (e.accountId.type === "expense") expense += Number(e.debit)  - Number(e.credit);
    }
    const profit = round(revenue - expense);

    year.isClosed = true;
    year.closedAt  = new Date();
    await year.save();

    return res.json({
      message:          "Financial year closed successfully",
      year:             year.name,
      profit,
      isClosed:         true,
    });
  } catch (err) {
    console.error("closeYear error:", err);
    return sendStructuredError(res, {
      code: "FY_CLOSE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ─── Get Year by ID ───────────────────────────────────────────────────────────

async function getYear(req, res) {
  try {
    const { id } = req.params ?? {};
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid year id" });
    }
    const year = await FinancialYear.findById(id).lean();
    if (!year) return res.status(404).json({ message: "Financial year not found" });
    return res.json(year);
  } catch (err) {
    console.error("getYear error:", err);
    return sendStructuredError(res, {
      code: "FY_GET_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ─── Seed Active Year (startup) ───────────────────────────────────────────────

async function seedActiveYear() {
  try {
    const existing = await FinancialYear.findOne({ isClosed: false }).lean();
    if (existing) return;

    const today = new Date();
    const month = today.getMonth(); // 0-indexed; April = 3

    const fyStartYear = month >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    const fyEndYear   = fyStartYear + 1;

    const startDate = new Date(`${fyStartYear}-04-01`);
    const endDate   = new Date(`${fyEndYear}-03-31`);
    const name      = `${fyStartYear}-${String(fyEndYear).slice(-2)}`;

    await FinancialYear.create({ name, startDate, endDate, isClosed: false });
    console.log(`FinancialYear: auto-created active year "${name}".`);
  } catch (err) {
    console.warn("seedActiveYear error:", err?.message ?? err);
  }
}

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = { createYear, listYears, closeYear, getYear, seedActiveYear };
