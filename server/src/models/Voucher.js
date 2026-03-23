const mongoose = require("mongoose");

/** Canonical voucher kinds (lowercase). Legacy values kept for existing rows. */
const VOUCHER_TYPES = [
  "sales",
  "purchase",
  "payment",
  "receipt",
  "journal",
  "expense",
  "tds",
  "payroll",
  "revenue",
  "adjustment",
];

const voucherSchema = new mongoose.Schema(
  {
    voucherNumber: { type: String, required: true, unique: true, trim: true },
    date: { type: Date, required: true, default: () => new Date() },
    type: {
      type: String,
      required: [true, "type is required"],
      enum: VOUCHER_TYPES,
      lowercase: true,
    },
    narration: { type: String, default: "" },
    financialYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialYear",
      default: null,
    },
    referenceType: { type: String, default: null },
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    /** For payment vouchers: originating invoice (unique constraint stays on payment+referenceId). */
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      default: null,
    },
    department: {
      type: String,
      enum: ["academy", "tech", "marketing"],
      default: null,
      lowercase: true,
    },
    reversedFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Voucher",
      default: null,
    },
    isReversed: { type: Boolean, default: false },
    reversedByVoucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Voucher",
      default: null,
    },
  },
  { timestamps: true },
);

voucherSchema.index({ financialYearId: 1, date: -1 });
voucherSchema.index({ reversedFrom: 1 });
voucherSchema.index({ date: -1 });
voucherSchema.index({ department: 1, date: -1 });
voucherSchema.index(
  { referenceType: 1, referenceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      referenceType: { $exists: true, $type: "string", $gt: "" },
      referenceId: { $exists: true, $type: "objectId" },
    },
  },
);

const Voucher = mongoose.model("Voucher", voucherSchema);
Voucher.VOUCHER_TYPES = VOUCHER_TYPES;
module.exports = Voucher;
