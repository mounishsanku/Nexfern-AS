const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const RevenueSchedule = require("../models/RevenueSchedule");
const CompanySettings = require("../models/CompanySettings");
const Entity = require("../models/Entity");
const LocalizationRegistry = require("../localization/registry/LocalizationRegistry");
const { normalizeTaxResult } = require("../localization/utils/normalizeTaxResult");
const mongoose = require("mongoose");
const { logAction, buildMetadata, ACTIONS } = require("../utils/audit");
const PDFDocument = require("pdfkit");
const {
  createVoucherForInvoice,
  createVoucherForDeferredInvoice,
} = require("../services/voucherService");
const { allocateNextInvoiceNumber } = require("../services/invoiceNumberService");
const { streamInvoicePdf } = require("../utils/invoicePdf");
const gstnEinvService = require("../services/gstnEinvService");
const {
  normalizeDepartment,
  defaultDepartmentFromRevenueType,
} = require("../utils/department");
const { round2 } = require("../utils/round");
const { assertPostTransactionAccountingInvariants } = require("../services/accountingInvariantsService");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

function parseNonNegativeNumber(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function createInvoiceFromData({
  userId,
  customerId,
  amount,
  gstRate,
  gstType,
  isDeferred,
  deferredMonths,
  revenueType,
  projectId = null,
  batchId = null,
  eventId = null,
  milestoneId = null,
  batchStudentId = null,
  department = null,
  financialYearId = null,
  entityId = null,
  currency = null,
  parentSession = null,
}) {
  if (!customerId || typeof customerId !== "string") {
    throw new Error("customerId is required");
  }
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    throw new Error("invalid customerId");
  }
  for (const [k, v] of [["projectId", projectId], ["batchId", batchId], ["eventId", eventId]]) {
    if (v && !mongoose.Types.ObjectId.isValid(v)) {
      throw new Error(`invalid ${k}`);
    }
  }
  const linkageCount = [projectId, batchId, eventId].filter(Boolean).length;
  if (linkageCount > 1) {
    throw new Error("invoice can be linked to only one of projectId, batchId, eventId");
  }
  const parsedAmount = parseNonNegativeNumber(amount);
  if (parsedAmount === null) {
    throw new Error("amount must be a non-negative number");
  }

  const parsedRate = parseNonNegativeNumber(gstRate) ?? 0;

  const normalizedGstType =
    typeof gstType === "string" && ["CGST_SGST", "IGST"].includes(gstType)
      ? gstType
      : "CGST_SGST";
  const normalizedRevenueType =
    typeof revenueType === "string" && ["project", "academy", "event"].includes(revenueType)
      ? revenueType
      : "project";
  const resolvedDepartment =
    normalizeDepartment(department) || defaultDepartmentFromRevenueType(normalizedRevenueType);

  const deferred = Boolean(isDeferred);
  const months = deferred
    ? Math.max(1, Math.min(120, Math.floor(parseNonNegativeNumber(deferredMonths) ?? 1)))
    : null;

  if (deferred && (!months || months < 1)) {
    throw new Error("deferredMonths must be at least 1 when isDeferred is true");
  }

  const settings = await CompanySettings.findOne().lean();
  const useNewLocalization = settings?.features?.USE_NEW_LOCALIZATION_ENGINE === true;
  const useMultiCurrency = settings?.features?.USE_MULTI_CURRENCY_ENGINE === true;

  let finalEntityId = null;
  // Resolve currency without hardcoding INR — derive from entity when possible.
  // The import engine always passes an explicit currency, so this fallback
  // only fires for direct API calls that omit the currency field.
  let resolvedEntityForCurrency = null;
  if (!currency && entityId) {
    const _eid = entityId || settings?.defaultEntityId;
    if (_eid) resolvedEntityForCurrency = await Entity.findById(_eid).select("baseCurrency").lean();
  }
  let finalCurrency = currency || resolvedEntityForCurrency?.baseCurrency || null;
  let finalExchangeRate = 1;
  let finalBaseAmount = parsedAmount;
  let finalCgst = 0;
  let finalSgst = 0;
  let finalIgst = 0;
  let finalTotalAmount = 0;
  let finalTaxLines = [];

  if (useNewLocalization) {
    let resolvedEntityId = entityId || settings?.defaultEntityId;
    if (!resolvedEntityId) {
      const e = new Error("Entity is required but could not be resolved");
      e.status = 400;
      throw e;
    }
    const entity = await Entity.findById(resolvedEntityId).lean();
    if (!entity) {
      const e = new Error("Entity not found");
      e.status = 400;
      throw e;
    }

    let pack;
    try {
      pack = LocalizationRegistry.get(entity.country);
    } catch (err) {
      const e = new Error(err.message);
      e.status = 400;
      throw e;
    }
    
    // Pass raw inputs as expected by pack validation
    const invoiceData = { amount: parsedAmount, gstRate, gstType, useGenericTaxEngine: settings?.features?.USE_GENERIC_TAX_ENGINE === true };
    await pack.validateInvoice(invoiceData, entity);
    const taxResult = await pack.calculateTax(invoiceData, entity);
    
    const normalized = normalizeTaxResult(taxResult);

    finalEntityId = entity._id;
    finalCurrency = currency || entity.baseCurrency;
    
    if (useMultiCurrency && finalCurrency !== entity.baseCurrency) {
      const { getExchangeRate } = require("../services/currencyService");
      const rateInfo = await getExchangeRate({
        fromCurrency: finalCurrency,
        toCurrency: entity.baseCurrency,
        effectiveDate: new Date()
      });
      finalExchangeRate = rateInfo.rate;
      finalBaseAmount = round2(parsedAmount * finalExchangeRate);
    }

    finalCgst = normalized.cgst;
    finalSgst = normalized.sgst;
    finalIgst = normalized.igst;
    const totalTax = normalized.totalTax;
    finalTotalAmount = round2(parsedAmount + totalTax);
    finalTaxLines = normalized.taxLines;
  } else {
    if (parsedRate > 0) {
      if (normalizedGstType === "CGST_SGST") {
        finalCgst = round2(parsedAmount * (parsedRate / 2) / 100);
        finalSgst = round2(parsedAmount * (parsedRate / 2) / 100);
      } else {
        finalIgst = round2(parsedAmount * parsedRate / 100);
      }
    }
    const totalTax = finalCgst + finalSgst + finalIgst;
    finalTotalAmount = round2(parsedAmount + totalTax);
  }

  if (!financialYearId) {
    throw new Error("Active financial year is required");
  }

  const isOwnedSession = !parentSession;
  const session = parentSession || await mongoose.startSession();
  let invoice = null;

  const coreLogic = async () => {
    const invoiceNumber = await allocateNextInvoiceNumber(financialYearId, session);

    const [inv] = await Invoice.create(
        [
          {
            customer: customerId,
            invoiceNumber,
            amount: parsedAmount,
            gstRate: parsedRate,
            gstType: normalizedGstType,
            cgst: finalCgst,
            sgst: finalSgst,
            igst: finalIgst,
            totalAmount: finalTotalAmount,
            financialYearId,
            status: "unpaid",
            isDeferred: deferred,
            deferredMonths: months,
            recognizedRevenue: 0,
            revenueType: normalizedRevenueType,
            department: resolvedDepartment,
            projectId: projectId || null,
            batchId: batchId || null,
            eventId: eventId || null,
            milestoneId: milestoneId || null,
            batchStudentId: batchStudentId || null,
            entityId: finalEntityId,
            currency: finalCurrency,
            exchangeRate: finalExchangeRate,
            baseAmount: finalBaseAmount,
            taxLines: finalTaxLines,
            createdAt: new Date(),
          },
        ],
        { session },
      );
      invoice = inv;

      if (deferred) {
        await createVoucherForDeferredInvoice({ invoice, financialYearId, session });
      } else {
        await createVoucherForInvoice({ invoice, financialYearId, session });
      }

      if (deferred && months > 0) {
        const base = invoice.amount;
        const perMonth = round2(base / months);
        const schedules = [];
        const startDate = new Date(invoice.createdAt);
        for (let i = 0; i < months; i++) {
          const d = new Date(startDate);
          d.setUTCMonth(d.getUTCMonth() + i + 1);
          d.setUTCDate(1);
          const amt = i === months - 1 ? base - perMonth * (months - 1) : perMonth;
          schedules.push({
            invoiceId: invoice._id,
            date: d,
            amount: amt,
            isRecognized: false,
          });
        }
        await RevenueSchedule.insertMany(schedules, { session });
      }

      await assertPostTransactionAccountingInvariants(financialYearId, session);
  };

  try {
    if (isOwnedSession) {
      await session.withTransaction(coreLogic);
    } else {
      await coreLogic();
    }
  } catch (txErr) {
    throw txErr;
  } finally {
    if (isOwnedSession) {
      await session.endSession();
    }
  }

  await logAction(userId, ACTIONS.CREATE, "invoice", invoice._id, buildMetadata(null, {
    invoiceNumber: invoice.invoiceNumber ?? null,
    customerId: invoice.customer?.toString?.() ?? invoice.customer,
    amount: invoice.amount,
    totalTax: (invoice.cgst ?? 0) + (invoice.sgst ?? 0) + (invoice.igst ?? 0),
    gstRate: invoice.gstRate,
    gstType: invoice.gstType,
    totalAmount: invoice.totalAmount,
    status: invoice.status,
    isDeferred: invoice.isDeferred,
    revenueType: invoice.revenueType,
    department: invoice.department,
    projectId: invoice.projectId?.toString?.() ?? null,
    batchId: invoice.batchId?.toString?.() ?? null,
    eventId: invoice.eventId?.toString?.() ?? null,
    milestoneId: invoice.milestoneId ?? null,
    batchStudentId: invoice.batchStudentId ?? null,
    createdAt: invoice.createdAt,
  }));

  return invoice;
}

async function createInvoice(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const {
      customerId, amount, gstRate, gstType, isDeferred, deferredMonths, revenueType,
      projectId, batchId, eventId, milestoneId, batchStudentId, department, entityId, currency,
    } = req.body ?? {};

    if (!customerId || typeof customerId !== "string") {
      return res.status(400).json({ message: "customerId is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ message: "invalid customerId" });
    }
    for (const [k, v] of [["projectId", projectId], ["batchId", batchId], ["eventId", eventId]]) {
      if (v && !mongoose.Types.ObjectId.isValid(v)) {
        return res.status(400).json({ message: `invalid ${k}` });
      }
    }

    const financialYearId = req.activeYear?._id ?? null;
    const invoice = await createInvoiceFromData({
      userId,
      customerId,
      amount,
      gstRate,
      gstType,
      isDeferred,
      deferredMonths,
      revenueType,
      projectId,
      batchId,
      eventId,
      milestoneId,
      batchStudentId,
      department,
      financialYearId,
      entityId,
      currency,
    });

    return res.status(201).json(invoice);
  } catch (err) {
    const msg = String(err?.message || "");
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
    if (
      msg.includes("must be") ||
      msg.includes("required") ||
      msg.includes("invalid")
    ) {
      return res.status(400).json({ message: msg });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "INVOICE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

function parseYMDToUTCDate(ymd) {
  if (typeof ymd !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;

  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1; // 0-based
  const day = Number(m[3]);
  const t = Date.UTC(year, monthIndex, day, 0, 0, 0, 0);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function getAllInvoices(req, res) {
  try {
    const { startDate, endDate } = req.query ?? {};

    const filter = {};
    const start = parseYMDToUTCDate(startDate);
    const end = parseYMDToUTCDate(endDate);

    if (start || end) {
      filter.createdAt = {};
      if (start) {
        filter.createdAt.$gte = start;
      }
      if (end) {
        const endUtc = new Date(
          Date.UTC(
            end.getUTCFullYear(),
            end.getUTCMonth(),
            end.getUTCDate(),
            23,
            59,
            59,
            999,
          ),
        );
        filter.createdAt.$lte = endUtc;
      }
    }

    const invoices = await Invoice.find(filter)
      .sort({ createdAt: -1 })
      .populate("customer")
      .lean();
    return res.json(invoices);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "INVOICE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function getInvoicePdf(req, res) {
  try {
    const { id } = req.params ?? {};
    if (!id || typeof id !== "string") {
      return res.status(400).json({ message: "invoice id required" });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid invoice id" });
    }

    const invoice = await Invoice.findById(id).populate("customer").lean();
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const displayNo = invoice.invoiceNumber || String(invoice._id);
    const safeFile = `invoice-${String(displayNo).replace(/[^\w.-]+/g, "_")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safeFile}"`);

    const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
    doc.pipe(res);
    streamInvoicePdf(doc, invoice);
    doc.end();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    // If headers already sent (streaming started), just end.
    if (res.headersSent) {
      try {
        res.end();
      } catch (_e) {
        // no-op
      }
      return;
    }
    return sendStructuredError(res, {
      code: "INVOICE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function updateInvoice(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const { id } = req.params ?? {};
    const { status } = req.body ?? {};

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid invoice id" });
    }

    const invoice = await Invoice.findById(id).lean();
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const allowed = ["unpaid", "partial", "paid"];
    const newStatus = typeof status === "string" ? status.toLowerCase().trim() : null;
    if (!newStatus || !allowed.includes(newStatus)) {
      return res.status(400).json({ message: "status must be unpaid, partial, or paid" });
    }

    const before = { status: invoice.status };
    const updated = await Invoice.findByIdAndUpdate(
      id,
      { $set: { status: newStatus } },
      { new: true },
    ).lean();

    await logAction(userId, ACTIONS.UPDATE, "invoice", id, buildMetadata(before, { status: updated.status }));

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return sendStructuredError(res, {
      code: "INVOICE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function deleteInvoice(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const { id } = req.params ?? {};

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid invoice id" });
    }

    const invoice = await Invoice.findById(id).lean();
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const paymentCount = await Payment.countDocuments({ invoiceId: id });
    if (paymentCount > 0 || (invoice.paidAmount ?? 0) > 0) {
      return res.status(403).json({
        message: "Cannot delete invoice with payments",
        code: "RECORD_IMMUTABLE",
      });
    }

    const before = {
      customerId: invoice.customer?.toString?.(),
      amount: invoice.amount,
      totalAmount: invoice.totalAmount,
      status: invoice.status,
    };

    await Invoice.findByIdAndDelete(id);

    await logAction(userId, ACTIONS.DELETE, "invoice", id, buildMetadata(before, null));

    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return sendStructuredError(res, {
      code: "INVOICE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function generateEInvoice(req, res) {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "invalid invoice id" });
    }

    const invoice = await Invoice.findById(id).populate("customer").lean();
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    if (invoice.irn) {
      return res.status(400).json({ message: "e-Invoice already generated for this invoice" });
    }

    const entity = await Entity.findById(invoice.entityId).lean();
    if (!entity) return res.status(400).json({ message: "Entity not found for this invoice" });

    // Call GSTN Service
    const result = await gstnEinvService.generateIRN(invoice, entity);

    if (result.success) {
      const updated = await Invoice.findByIdAndUpdate(
        id,
        {
          $set: {
            irn: result.irn,
            qrCode: result.qrCode,
            ackNo: result.ackNo,
            ackDate: result.ackDate,
            einvoiceStatus: "generated",
          }
        },
        { new: true }
      ).lean();

      await logAction(req.user?.id, ACTIONS.UPDATE, "invoice", id, { action: "einvoice_generated", irn: result.irn });
      return res.json(updated);
    } else {
      await Invoice.findByIdAndUpdate(id, { $set: { einvoiceStatus: "failed", einvoiceError: result.error } });
      return res.status(422).json({ message: result.error, code: "GSTN_REJECTION" });
    }
  } catch (err) {
    logger.error("einvoice: generation failed", { error: err.message });
    return res.status(500).json({ message: "Internal server error during e-invoicing" });
  }
}

module.exports = {
  createInvoice,
  createInvoiceFromData,
  getAllInvoices,
  getInvoicePdf,
  updateInvoice,
  deleteInvoice,
  generateEInvoice,
};

