const mongoose = require("mongoose");

const payslipSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    month: { type: String, required: true }, // YYYY-MM
    gross: { type: Number, required: true, min: 0 },
    deductions: { type: Number, required: true, min: 0 },
    tds: { type: Number, required: true, min: 0, default: 0 },
    pfAmount: { type: Number, required: true, min: 0, default: 0 },
    esiAmount: { type: Number, required: true, min: 0, default: 0 },
    net: { type: Number, required: true, min: 0 },
    generatedAt: { type: Date, default: Date.now },
    financialYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialYear",
      default: null,
    },
    voucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Voucher",
      default: null,
    },
  },
  { timestamps: false }
);

payslipSchema.index({ employeeId: 1, month: 1 }, { unique: true });
payslipSchema.index({ month: -1, generatedAt: -1 });

module.exports = mongoose.model("Payslip", payslipSchema);
