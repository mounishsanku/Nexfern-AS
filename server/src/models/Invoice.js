const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    /** Human-readable e.g. INV-2026-0001 */
    invoiceNumber: { type: String, trim: true, default: null },
    amount: { type: Number, required: true, min: 0 },
    financialYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialYear",
      default: null,
    },
    gstType: {
      type: String,
    },
    gstRate: { type: Number, default: 0, min: 0 },
    cgst: { type: Number, required: true, default: 0, min: 0 },
    sgst: { type: Number, required: true, default: 0, min: 0 },
    igst: { type: Number, required: true, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0, default: 0 },
    status: {
      type: String,
      required: true,
      enum: ["unpaid", "partial", "paid"],
      lowercase: true,
      default: "unpaid",
    },
    isDeferred: { type: Boolean, default: false },
    deferredMonths: { type: Number, default: null },
    recognizedRevenue: { type: Number, default: 0 },
    revenueType: {
      type: String,
      enum: ["project", "academy", "event"],
      default: "project",
      lowercase: true,
    },
    department: {
      type: String,
      enum: ["academy", "tech", "marketing"],
      default: null,
      lowercase: true,
    },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", default: null },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", default: null },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
    milestoneId: { type: String, default: null },
    batchStudentId: { type: String, default: null },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      index: true,
      default: null,
    },
    currency: { type: String },
    exchangeRate: { type: Number, default: 1 },
    baseAmount: { type: Number, default: null },
    taxLines: {
      type: [{
        name: { type: String, required: true },
        code: { type: String, required: true },
        taxType: { type: String, required: true },
        rate: { type: Number, required: true, min: 0 },
        amount: { type: Number, required: true, min: 0 }
      }],
      default: []
    },
    createdAt: { type: Date, default: Date.now },
    isReversed: { type: Boolean, default: false },
    // e-Invoicing Fields
    irn: { type: String, trim: true, default: null },
    qrCode: { type: String, trim: true, default: null },
    ackNo: { type: String, trim: true, default: null },
    ackDate: { type: String, trim: true, default: null },
    einvoiceStatus: {
      type: String,
      enum: ["none", "generated", "cancelled", "failed"],
      default: "none",
      lowercase: true,
    },
    einvoiceError: { type: String, default: null },
  },
  { timestamps: false },
);

invoiceSchema.index({ createdAt: -1 });
invoiceSchema.index({ financialYearId: 1, createdAt: -1 });
invoiceSchema.index({ invoiceNumber: 1 }, { unique: true, sparse: true });
invoiceSchema.index({ revenueType: 1, createdAt: -1 });
invoiceSchema.index({ department: 1, createdAt: -1 });
invoiceSchema.index({ projectId: 1, createdAt: -1 });
invoiceSchema.index({ batchId: 1, createdAt: -1 });
invoiceSchema.index({ eventId: 1, createdAt: -1 });

module.exports = mongoose.model("Invoice", invoiceSchema);

