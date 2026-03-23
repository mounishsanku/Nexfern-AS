const mongoose = require("mongoose");

const revenueScheduleSchema = new mongoose.Schema(
  {
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
    },
    date: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    isRecognized: { type: Boolean, default: false },
  },
  { timestamps: false }
);

revenueScheduleSchema.index({ invoiceId: 1, date: 1 });
revenueScheduleSchema.index({ isRecognized: 1, date: 1 });

module.exports = mongoose.model("RevenueSchedule", revenueScheduleSchema);
