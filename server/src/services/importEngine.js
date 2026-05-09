const xlsx = require("xlsx");
const mongoose = require("mongoose");
const ImportJob = require("../models/ImportJob");
const { createInvoiceFromData } = require("../controllers/invoiceController");
const { createExpenseFromData } = require("../controllers/expenseController");
const Customer = require("../models/Customer");
const Vendor = require("../models/Vendor");
const tallyParser = require("./tallyParser");
const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");

// ─── Column templates (what headers each sheet type expects) ─────────────────

const TEMPLATES = {
  invoice: {
    headers: ["customerId", "amount", "gstRate", "gstType", "currency", "revenueType", "isDeferred", "deferredMonths"],
    example: { customerId: "<Required: ObjectId>", amount: "<Required: Positive Number>", gstRate: 18, gstType: "CGST_SGST", currency: "INR", revenueType: "project", isDeferred: false, deferredMonths: "" },
  },
  expense: {
    headers: ["title", "amount", "category", "date", "vendorId", "department", "tdsApplicable", "tdsRate"],
    example: { title: "<Required: String>", amount: "<Required: Positive Number>", category: "office", date: "<Required: YYYY-MM-DD>", vendorId: "<ObjectId or empty>", department: "tech", tdsApplicable: false, tdsRate: 0 },
  },
  customer: {
    headers: ["name", "email", "phone", "addressLine1", "city", "state", "pincode", "gstin"],
    example: { name: "<Required: String>", email: "billing@acme.com", phone: "9999999999", addressLine1: "12 MG Road", city: "Mumbai", state: "Maharashtra", pincode: "400001", gstin: "" },
  },
  vendor: {
    headers: ["name", "email", "phone", "gstNumber"],
    example: { name: "<Required: String>", email: "accounts@supplies.co", phone: "8888888888", gstNumber: "" },
  },
  payment: {
    headers: ["partyName", "amount", "date", "reference", "method"],
    example: { partyName: "<Required: String>", amount: "<Required: Positive Number>", date: "<Required: YYYY-MM-DD>", reference: "CHQ-123", method: "bank" },
  },
};

/**
 * Generate a template .xlsx buffer for a given import type.
 */
function generateTemplateBuffer(type) {
  const template = TEMPLATES[type];
  if (!template) throw new Error(`No template defined for type: ${type}`);

  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet([template.example], { header: template.headers });

  // Style the header row as bold (best-effort — xlsx doesn't support rich styles natively)
  xlsx.utils.book_append_sheet(wb, ws, type.charAt(0).toUpperCase() + type.slice(1) + "s");
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
}

/**
 * Parses uploaded buffer via xlsx into standard JSON
 */
function parseBuffer(buffer, source, type) {
  if (source === "tally") {
    return tallyParser.parse(buffer, type);
  }
  const workbook = xlsx.read(buffer, { type: "buffer" });
  if (!workbook.SheetNames.length) throw new Error("Excel file is empty");
  
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  
  return xlsx.utils.sheet_to_json(worksheet, { defval: null });
}

// ─── Row validators ───────────────────────────────────────────────────────────

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isPositiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

async function validateRow(row, type, index, source) {
  const errors = [];

  if (source === "tally" && (type === "invoice" || type === "payment")) {
    if (!row.partyName && !row.customerId) {
      errors.push({ field: "partyName", message: "partyName is required for Tally import" });
    }
  }

  if (type === "invoice") {
    if (!row.customerId) errors.push({ field: "customerId", message: "customerId is required" });
    if (row.amount === null || row.amount === undefined) errors.push({ field: "amount", message: "amount is required" });
    else if (!isPositiveNumber(row.amount)) errors.push({ field: "amount", message: "amount must be a positive number" });
    if (row.customerId) {
      if (!mongoose.Types.ObjectId.isValid(String(row.customerId))) {
        errors.push({ field: "customerId", message: "Invalid customerId format (must be a MongoDB ObjectId)" });
      } else {
        const exists = await Customer.exists({ _id: row.customerId });
        if (!exists) errors.push({ field: "customerId", message: "Customer not found in database" });
      }
    }
  } else if (type === "expense") {
    if (!isNonEmptyString(row.title)) errors.push({ field: "title", message: "title is required" });
    if (!isNonEmptyString(row.category)) errors.push({ field: "category", message: "category is required" });
    if (row.amount === null || row.amount === undefined) errors.push({ field: "amount", message: "amount is required" });
    else if (!isPositiveNumber(row.amount)) errors.push({ field: "amount", message: "amount must be a positive number" });
    if (!row.date) errors.push({ field: "date", message: "date is required" });
    else if (Number.isNaN(new Date(row.date).getTime())) errors.push({ field: "date", message: "date is not a valid date" });
  } else if (type === "payment") {
    if (!row.amount || isNaN(row.amount)) errors.push({ field: "amount", message: "amount is required and must be a number" });
    if (!row.partyName && !row.customerId) errors.push({ field: "partyName", message: "partyName or customerId is required" });
  } else if (type === "customer") {
    if (!isNonEmptyString(row.name)) errors.push({ field: "name", message: "name is required" });
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row.email).trim())) {
      errors.push({ field: "email", message: "email format is invalid" });
    }
    // Duplicate check — same name (case-insensitive) + email
    if (isNonEmptyString(row.name)) {
      const dup = await Customer.findOne({ name: new RegExp(`^${row.name.trim()}$`, "i") }).lean();
      if (dup) errors.push({ field: "name", message: `Customer "${row.name.trim()}" already exists` });
    }
  } else if (type === "vendor") {
    if (!isNonEmptyString(row.name)) errors.push({ field: "name", message: "name is required" });
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row.email).trim())) {
      errors.push({ field: "email", message: "email format is invalid" });
    }
    // Duplicate check
    if (isNonEmptyString(row.name)) {
      const dup = await Vendor.findOne({ name: new RegExp(`^${row.name.trim()}$`, "i") }).lean();
      if (dup) errors.push({ field: "name", message: `Vendor "${row.name.trim()}" already exists` });
    }
  }

  return { errors };
}

// ─── validateJob ─────────────────────────────────────────────────────────────

async function validateJob(jobId) {
  const job = await ImportJob.findById(jobId);
  if (!job) throw new Error("Import job not found");
  if (job.status !== "validating") return job;

  let validRowsCount = 0;
  let errorRowsCount = 0;
  const allErrors = [];

  for (let i = 0; i < job.previewData.length; i++) {
    const { errors } = await validateRow(job.previewData[i], job.type, i, job.source);
    if (errors.length > 0) {
      errorRowsCount++;
      errors.forEach(e => allErrors.push({ row: i, field: e.field, message: e.message }));
    } else {
      validRowsCount++;
    }
  }

  job.errors = allErrors;
  job.summary.validRows = validRowsCount;
  job.summary.errorRows = errorRowsCount;
  job.status = errorRowsCount > 0 ? "failed" : "ready";
  await job.save();
  return job;
}

// ─── stageImport ─────────────────────────────────────────────────────────────

async function stageImport({ buffer, fileName, entityId, type, source, userId }) {
  const ALLOWED_TYPES = ["invoice", "expense", "customer", "vendor", "payment"];
  if (!ALLOWED_TYPES.includes(type)) throw new Error(`Unsupported import type: ${type}`);

  const data = parseBuffer(buffer, source, type);
  if (data.length === 0) throw new Error(`${source || "File"} contains no data rows`);
  if (data.length > 5000) throw new Error("Import batch exceeds the 5,000-row limit");

  const job = new ImportJob({
    entityId,
    type,
    source: source || "excel",
    uploadedBy: userId,
    fileName,
    status: "validating",
    previewData: data,
    summary: { totalRows: data.length, validRows: 0, errorRows: 0, importedRows: 0 },
  });
  await job.save();
  return validateJob(job._id);
}

// ─── Row executors ────────────────────────────────────────────────────────────

async function executeCustomerRow(row, session) {
  const [doc] = await Customer.create(
    [{
      name: row.name.trim(),
      email: row.email ? String(row.email).trim().toLowerCase() : null,
      phone: row.phone ? String(row.phone).trim() : null,
      addressLine1: row.addressLine1 ? String(row.addressLine1).trim() : null,
      city: row.city ? String(row.city).trim() : null,
      state: row.state ? String(row.state).trim() : null,
      pincode: row.pincode ? String(row.pincode).trim() : null,
      gstin: row.gstin ? String(row.gstin).trim() : null,
      createdAt: new Date(),
    }],
    { session }
  );
  return doc;
}

async function executeVendorRow(row, session) {
  const [doc] = await Vendor.create(
    [{
      name: row.name.trim(),
      email: row.email ? String(row.email).trim().toLowerCase() : null,
      phone: row.phone ? String(row.phone).trim() : null,
      gstNumber: row.gstNumber ? String(row.gstNumber).trim() : null,
    }],
    { session }
  );
  return doc;
}

async function executePaymentRow(row, session, entityId, financialYearId) {
  let customerId = row.customerId;
  if (!customerId && row.partyName) {
    const customer = await Customer.findOne({ name: new RegExp(`^${row.partyName.trim()}$`, "i") }).session(session);
    if (customer) customerId = customer._id;
  }

  if (!customerId) throw new Error(`Customer not found for party: ${row.partyName}`);

  // Link to oldest unpaid invoice
  const invoice = await Invoice.findOne({ customer: customerId, entityId, status: { $ne: "paid" } })
    .sort({ date: 1 })
    .session(session);

  if (!invoice) throw new Error(`No pending invoice found to link payment for ${row.partyName}`);

  const [payment] = await Payment.create(
    [{
      invoiceId: invoice._id,
      amount: Number(row.amount),
      method: row.method || "bank",
      reference: row.reference || row.tallyVoucherNumber || "Tally Import",
      date: row.date ? new Date(row.date) : new Date(),
      entityId,
      financialYearId,
    }],
    { session }
  );

  const totalPaid = (invoice.paidAmount || 0) + payment.amount;
  const isPaid = totalPaid >= invoice.totalAmount;
  await Invoice.updateOne(
    { _id: invoice._id },
    { $set: { paidAmount: totalPaid, status: isPaid ? "paid" : "partially_paid" } }
  ).session(session);

  return payment;
}

// ─── executeImport ────────────────────────────────────────────────────────────

async function executeImport(jobId, financialYearId) {
  const job = await ImportJob.findById(jobId);
  if (!job) throw new Error("Import job not found");
  if (job.status !== "ready") throw new Error(`Job cannot be executed from status: ${job.status}`);

  job.status = "importing";
  await job.save();

  const session = await mongoose.startSession();
  let importedCount = 0;

  try {
    await session.withTransaction(async () => {
      for (let i = 0; i < job.previewData.length; i++) {
        const row = job.previewData[i];
        try {
          if (job.type === "invoice") {
            await createInvoiceFromData({
              userId: job.uploadedBy,
              customerId: String(row.customerId),
              amount: Number(row.amount),
              gstRate: row.gstRate ? Number(row.gstRate) : 0,
              gstType: row.gstType || null,
              isDeferred: row.isDeferred === true || row.isDeferred === "true",
              deferredMonths: row.deferredMonths ? Number(row.deferredMonths) : null,
              revenueType: row.revenueType || "project",
              financialYearId,
              entityId: job.entityId,
              currency: row.currency || null,
              parentSession: session,
            });
          } else if (job.type === "expense") {
            await createExpenseFromData({
              userId: job.uploadedBy,
              title: String(row.title),
              amount: Number(row.amount),
              category: String(row.category),
              vendorId: row.vendorId || null,
              date: new Date(row.date),
              financialYearId,
              isApprover: true,
              autoApprove: true,
              tdsApplicable: row.tdsApplicable === true || row.tdsApplicable === "true",
              tdsRate: row.tdsRate ? Number(row.tdsRate) : 0,
              department: row.department || null,
              parentSession: session,
            });
          } else if (job.type === "customer") {
            await executeCustomerRow(row, session);
          } else if (job.type === "vendor") {
            await executeVendorRow(row, session);
          } else if (job.type === "payment") {
            await executePaymentRow(row, session, job.entityId, financialYearId);
          }
          importedCount++;
        } catch (err) {
          const rowError = new Error(`Row ${i + 1} failed: ${err.message}`);
          rowError.code = "IMPORT_ROW_FAILED";
          rowError.importedCount = importedCount;
          throw rowError;
        }
      }
    });

    job.summary.importedRows = importedCount;
    job.status = "completed";
  } catch (err) {
    job.summary.importedRows = 0;
    job.status = "failed";
    job.errors.push({
      row: null,
      message: err.message,
      field: "execution",
      code: err.code || "IMPORT_FAILED",
      validatedBeforeFailure: err.importedCount || 0,
    });
  } finally {
    await session.endSession();
    await job.save();
  }

  return job;
}

module.exports = {
  stageImport,
  validateJob,
  executeImport,
  generateTemplateBuffer,
  TEMPLATES,
};
