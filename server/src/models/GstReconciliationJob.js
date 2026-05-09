const mongoose = require("mongoose");

const gstReconciliationJobSchema = new mongoose.Schema(
  {
    entityId: { type: mongoose.Schema.Types.ObjectId, ref: "Entity", required: true, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    fileName: { type: String, required: true },
    sourceType: { type: String, enum: ["2A", "2B"], default: "2B" },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    summary: {
      totalPortalRows: { type: Number, default: 0 },
      matchedRows: { type: Number, default: 0 },
      discrepancyRows: { type: Number, default: 0 },
      missingInBooksRows: { type: Number, default: 0 }, // In portal, not in Nexfern
      unclaimedInPortalRows: { type: Number, default: 0 }, // In Nexfern, not in portal
    },
    errors: [String],
  },
  { timestamps: true }
);

module.exports = mongoose.model("GstReconciliationJob", gstReconciliationJobSchema);
