const mongoose = require("mongoose");

const accessLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, ref: "Entity" },
    ip: { type: String, required: true },
    userAgent: { type: String },
    route: { type: String, required: true },
    method: { type: String, required: true },
    statusCode: { type: Number, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

module.exports = mongoose.model("AccessLog", accessLogSchema);
