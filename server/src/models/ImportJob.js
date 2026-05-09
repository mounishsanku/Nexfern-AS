const mongoose = require("mongoose");

const importJobSchema = new mongoose.Schema(
  {
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["invoice", "expense", "customer", "vendor", "payment"],
    },
    source: {
      type: String,
      required: true,
      enum: ["excel", "csv", "tally"],
      default: "excel",
    },
    status: {
      type: String,
      required: true,
      enum: ["uploaded", "validating", "ready", "importing", "completed", "failed"],
      default: "uploaded",
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    summary: {
      totalRows: { type: Number, default: 0 },
      validRows: { type: Number, default: 0 },
      errorRows: { type: Number, default: 0 },
      importedRows: { type: Number, default: 0 },
    },
    errors: [
      {
        row: { type: Number },
        message: { type: String },
        field: { type: String },
      },
    ],
    warnings: [
      {
        row: { type: Number },
        message: { type: String },
      },
    ],
    previewData: {
      type: mongoose.Schema.Types.Mixed,
      default: [],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true, suppressReservedKeysWarning: true }
);

module.exports = mongoose.model("ImportJob", importJobSchema);
