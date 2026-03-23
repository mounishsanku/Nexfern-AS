const mongoose = require("mongoose");

const vendorSchema = new mongoose.Schema(
  {
    name:      { type: String, required: true, trim: true },
    email:     { type: String, trim: true, lowercase: true, default: null },
    phone:     { type: String, trim: true, default: null },
    gstNumber: { type: String, trim: true, default: null },
  },
  { timestamps: true },
);

vendorSchema.index({ name: 1 });

module.exports = mongoose.model("Vendor", vendorSchema);
