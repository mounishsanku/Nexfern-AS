const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
    action: { type: String, required: true, trim: true },
    entity: { type: String, required: true, trim: true },
    entityId: { type: String, default: "" },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    data: { type: mongoose.Schema.Types.Mixed, default: null },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// ---------------------------------------------------------------------------
// IMMUTABLE: Only INSERT allowed. Block UPDATE and DELETE.
// ---------------------------------------------------------------------------
const immutableError = new Error("AuditLog is immutable; only INSERT allowed");

function callNext(next, err) {
  if (typeof next === "function") return next(err);
  if (err) return Promise.reject(err);
  return undefined;
}

auditLogSchema.pre(["updateOne", "findOneAndUpdate", "updateMany", "replaceOne"], function (next) {
  return callNext(next, immutableError);
});

auditLogSchema.pre(["deleteOne", "findOneAndDelete", "deleteMany"], function (next) {
  return callNext(next, immutableError);
});

// Block doc.save() when document exists (update)
auditLogSchema.pre("save", function (next) {
  if (!this.isNew) return callNext(next, immutableError);
  return callNext(next);
});

auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ entity: 1, timestamp: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);

