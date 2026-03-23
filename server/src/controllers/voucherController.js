const mongoose     = require("mongoose");
const Voucher      = require("../models/Voucher");
const VoucherEntry = require("../models/VoucherEntry");
const { createVoucher, reverseVoucherById } = require("../services/voucherService");
const { logActionFromReq, buildMetadata, ACTIONS } = require("../utils/audit");
const { normalizeDepartment } = require("../utils/department");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

async function fetchVoucherAuditSnapshot(voucherId) {
  const voucher = await Voucher.findById(voucherId).lean();
  if (!voucher) return null;
  const rows = await VoucherEntry.find({ voucherId })
    .populate("accountId", "name")
    .lean();
  const entries = rows.map((e) => ({
    _id: e._id,
    debit: e.debit,
    credit: e.credit,
    account: e.accountId?.name ?? String(e.accountId?._id ?? ""),
  }));
  return { voucher, entries };
}

// ─── Create Voucher (manual journal entry) ────────────────────────────────────

async function postVoucher(req, res) {
  try {
    const { type, narration, entries, department } = req.body ?? {};
    const normalizedType = String(type || "").trim().toLowerCase();

    if (!normalizedType || !Voucher.VOUCHER_TYPES.includes(normalizedType)) {
      return res.status(400).json({
        message: `Valid voucher type is required: one of ${Voucher.VOUCHER_TYPES.join(", ")}`,
        code: "VOUCHER_TYPE_INVALID",
      });
    }
    if (!Array.isArray(entries) || entries.length < 2) {
      return res.status(400).json({ message: "At least 2 entries (debit + credit) required" });
    }

    if (!req.activeYear?._id) {
      return res.status(400).json({ message: "Active financial year is required" });
    }

    const { voucher, entries: voucherEntries } = await createVoucher({
      type: normalizedType,
      narration,
      entries,
      financialYearId: req.activeYear._id,
      department: normalizeDepartment(department),
    });

    await logActionFromReq(req, ACTIONS.CREATE, "voucher", voucher._id, buildMetadata(null, {
      type: voucher.type,
      narration: voucher.narration,
    }));

    return res.status(201).json({ voucher, entries: voucherEntries });
  } catch (err) {
    if (err?.code === "INVALID_VOUCHER" || err?.code === "VOUCHER_NUMBER_FAILED") {
      return sendStructuredError(res, {
        status: 400,
        code: "INVALID_VOUCHER",
        message: err.message || "Invalid voucher",
        action: ACTION.CONTACT_ADMIN,
      });
    }
    if (err.message?.includes("Double-entry violated")) {
      return sendStructuredError(res, {
        status: 400,
        code: "INVALID_VOUCHER",
        message: err.message,
        action: ACTION.CONTACT_ADMIN,
      });
    }
    console.error(err);
    return sendStructuredError(res, {
      status: 503,
      code: "INVALID_VOUCHER",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ─── List Vouchers ────────────────────────────────────────────────────────────

async function getVouchers(req, res) {
  try {
    const { financialYearId, type, page = 1, limit = 50 } = req.query ?? {};

    const filter = {};
    if (financialYearId) filter.financialYearId = financialYearId;
    if (type)           filter.type = type;

    const skip = (Number(page) - 1) * Number(limit);

    const [vouchers, total] = await Promise.all([
      Voucher.find(filter)
        .sort({ date: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Voucher.countDocuments(filter),
    ]);

    // Fetch entries for all vouchers in one query
    const voucherIds = vouchers.map((v) => v._id);
    const entries = await VoucherEntry.find({ voucherId: { $in: voucherIds } })
      .populate("accountId", "name")
      .lean();

    // Map entries to their voucher
    const entryMap = {};
    for (const e of entries) {
      const key = e.voucherId.toString();
      if (!entryMap[key]) entryMap[key] = [];
      entryMap[key].push(e);
    }

    const result = vouchers.map((v) => ({
      ...v,
      entries: entryMap[v._id.toString()] ?? [],
    }));

    return res.json({ total, page: Number(page), limit: Number(limit), vouchers: result });
  } catch (err) {
    console.error(err);
    return sendStructuredError(res, {
      status: 503,
      code: "INVALID_VOUCHER",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ─── Get single Voucher with entries ─────────────────────────────────────────

async function getVoucherById(req, res) {
  try {
    const { id } = req.params ?? {};
    const voucher = await Voucher.findById(id).lean();
    if (!voucher) return res.status(404).json({ message: "Voucher not found" });

    const entries = await VoucherEntry.find({ voucherId: id })
      .populate("accountId", "name")
      .lean();
    return res.json({ ...voucher, entries });
  } catch (err) {
    console.error(err);
    return sendStructuredError(res, {
      status: 503,
      code: "INVALID_VOUCHER",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function reverseVoucher(req, res) {
  try {
    const { voucherId } = req.params ?? {};
    if (!mongoose.Types.ObjectId.isValid(voucherId)) {
      return res.status(400).json({ message: "invalid voucher id" });
    }
    if (!req.activeYear?._id) {
      return res.status(400).json({ message: "Active financial year is required" });
    }

    const before = await fetchVoucherAuditSnapshot(voucherId);
    if (!before) {
      return res.status(404).json({ message: "Voucher not found" });
    }

    const result = await reverseVoucherById({
      originalVoucherId: voucherId,
      financialYearId: req.activeYear._id,
    });

    const revId = result.reversal?.voucher?._id;
    const after = revId ? await fetchVoucherAuditSnapshot(revId) : null;

    await logActionFromReq(
      req,
      ACTIONS.REVERSE,
      "voucher",
      voucherId,
      buildMetadata(
        { voucher: before.voucher, entries: before.entries },
        {
          voucher: after?.voucher ?? result.reversal.voucher,
          entries: after?.entries ?? result.reversal.entries,
        },
      ),
    );

    return res.status(201).json(result);
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ message: err.message });
    }
    if (err.status === 400) {
      return res.status(400).json({ message: err.message, code: err.code });
    }
    console.error(err);
    return sendStructuredError(res, {
      status: 503,
      code: "INVALID_VOUCHER",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

module.exports = { postVoucher, getVouchers, getVoucherById, reverseVoucher };
