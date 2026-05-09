const mongoose = require("mongoose");

const gstPortalPurchaseSchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: "GstReconciliationJob", index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, ref: "Entity", index: true },
    gstin: { type: String, required: true }, // Vendor GSTIN
    tradeName: { type: String },
    invoiceNumber: { type: String, required: true },
    invoiceDate: { type: Date },
    invoiceType: { type: String },
    taxableValue: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    totalGst: { type: Number, default: 0 },
    totalInvoiceValue: { type: Number, default: 0 },
    // Matching Metadata
    matchStatus: {
      type: String,
      enum: ["unmatched", "matched", "discrepancy"],
      default: "unmatched",
    },
    matchedExpenseId: { type: mongoose.Schema.Types.ObjectId, ref: "Expense", default: null },
    discrepancyNote: { type: String, default: null },
  },
  { timestamps: true }
);

gstPortalPurchaseSchema.index({ gstin: 1, invoiceNumber: 1 });

module.exports = mongoose.model("GstPortalPurchase", gstPortalPurchaseSchema);
