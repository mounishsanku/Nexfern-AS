const mongoose = require("mongoose");

const studentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: null },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
    isPaid: { type: Boolean, default: false },
    lastInvoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", default: null },
  },
  { _id: false }
);

const batchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    course: { type: String, required: true, trim: true },
    fee: { type: Number, required: true, min: 0 },
    students: { type: [studentSchema], default: [] },
  },
  { timestamps: true }
);

batchSchema.index({ course: 1, createdAt: -1 });

module.exports = mongoose.model("Batch", batchSchema);
