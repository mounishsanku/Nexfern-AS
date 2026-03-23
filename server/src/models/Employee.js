const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    salary: { type: Number, required: true, min: 0, default: 0 },
    role: { type: String, trim: true, default: "employee" },
    joiningDate: { type: Date, required: true, default: Date.now },
    isActive: { type: Boolean, default: true },
    basicSalary: { type: Number, required: true, min: 0, default: 0 },
    allowances: { type: Number, min: 0, default: 0 },
    deductions: { type: Number, min: 0, default: 0 },
    tds: { type: Number, min: 0, default: 0 },
    pfAmount: { type: Number, min: 0, default: 0 },
    esiAmount: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true }
);

employeeSchema.index({ email: 1 }, { unique: true });
employeeSchema.index({ isActive: 1 });

module.exports = mongoose.model("Employee", employeeSchema);
