const mongoose = require("mongoose");

const CATEGORIES = ["rent", "salary", "marketing", "tools", "utilities", "travel", "other"];

const expenseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true },
    category: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    department: {
      type: String,
      enum: ["academy", "tech", "marketing"],
      default: "tech",
      lowercase: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
    },
    attachmentUrl: { type: String, default: null },
    billUrl: { type: String, default: null },
    isRecurring: { type: Boolean, default: false },
    recurringInterval: { type: String, enum: ["monthly"], default: null },
    recurringSourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Expense",
      default: null,
    },
    tdsApplicable: { type: Boolean, default: false },
    tdsRate: { type: Number, default: 0, min: 0, max: 30 },
    tdsAmount: { type: Number, default: 0, min: 0 },
    date: { type: Date, default: Date.now },
    financialYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialYear",
      default: null,
    },
    matched: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    isReversed: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      lowercase: true,
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    /** If pending, approver may set on approve */
    bankAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BankAccount", default: null },
  },
  { timestamps: false },
);

expenseSchema.index({ date: -1 });
expenseSchema.index({ category: 1 });
expenseSchema.index({ department: 1, date: -1 });
expenseSchema.index({ vendorId: 1 });
expenseSchema.index({ isRecurring: 1 });
expenseSchema.index({ recurringSourceId: 1, date: 1 });
expenseSchema.index({ tdsApplicable: 1, date: -1 });

module.exports = mongoose.model("Expense", expenseSchema);
module.exports.CATEGORIES = CATEGORIES;
