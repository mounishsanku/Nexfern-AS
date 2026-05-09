const express = require("express");
const multer = require("multer");
const { stageImport, executeImport, generateTemplateBuffer, TEMPLATES } = require("../services/importEngine");
const ImportJob = require("../models/ImportJob");
const { ACTION, sendStructuredError } = require("../utils/httpErrorResponse");
const logger = require("../utils/logger");

// 20 MB limit — prevent oversized uploads crashing the parser
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "application/xml",
      "text/xml",
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls|csv|xml)$/i)) {
      cb(null, true);
    } else {
      cb(new Error("Only .xlsx, .xls, .csv, and .xml files are accepted"));
    }
  },
});

const router = express.Router();

// ─── GET /import/template/:type ──────────────────────────────────────────────
// Download a pre-filled Excel template for a given import type.
router.get("/template/:type", (req, res) => {
  const { type } = req.params;
  if (!TEMPLATES[type]) {
    return res.status(400).json({ message: `No template for type: ${type}. Valid: ${Object.keys(TEMPLATES).join(", ")}` });
  }
  try {
    const buffer = generateTemplateBuffer(type);
    res.setHeader("Content-Disposition", `attachment; filename="nexfern_${type}_template.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buffer);
  } catch (err) {
    logger.error("import: template generation failed", { type, error: err?.message });
    return res.status(500).json({ message: "Failed to generate template" });
  }
});

// ─── POST /import/upload ─────────────────────────────────────────────────────
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const { type, entityId, source } = req.body;
    if (!type || !entityId) {
      return res.status(400).json({ message: "type and entityId are required" });
    }

    logger.info("import: staging upload", { type, entityId, source, fileName: req.file.originalname, userId });

    const job = await stageImport({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      entityId,
      type,
      source: source || "excel",
      userId,
    });

    return res.status(201).json(job);
  } catch (err) {
    logger.error("import: upload failed", { error: err?.message });
    return sendStructuredError(res, {
      status: 400,
      code: "IMPORT_STAGE_FAILED",
      message: err.message,
      action: ACTION.FIX_REQUIRED,
    });
  }
});

// ─── GET /import/preview/:jobId ──────────────────────────────────────────────
router.get("/preview/:jobId", async (req, res) => {
  try {
    const job = await ImportJob.findById(req.params.jobId).lean();
    if (!job) return res.status(404).json({ message: "Job not found" });
    return res.json(job);
  } catch (err) {
    logger.error("import: preview failed", { error: err?.message });
    return res.status(500).json({ message: "Failed to fetch preview" });
  }
});

// ─── POST /import/execute/:jobId ─────────────────────────────────────────────
router.post("/execute/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const financialYearId = req.activeYear?._id;

    // customer/vendor imports don't require a financial year
    const job = await ImportJob.findById(jobId).lean();
    if (!job) return res.status(404).json({ message: "Job not found" });

    const needsFY = ["invoice", "expense", "payment"].includes(job.type);
    if (needsFY && !financialYearId) {
      return res.status(400).json({ message: `Active financial year is required for ${job.type} imports` });
    }

    logger.info("import: executing", { jobId, type: job.type, financialYearId: financialYearId?.toString() });
    const result = await executeImport(jobId, financialYearId);
    return res.json(result);
  } catch (err) {
    logger.error("import: execution failed", { error: err?.message });
    return sendStructuredError(res, {
      status: 400,
      code: "IMPORT_EXECUTE_FAILED",
      message: err.message,
      action: ACTION.FIX_REQUIRED,
    });
  }
});

// ─── GET /import/jobs ────────────────────────────────────────────────────────
router.get("/jobs", async (req, res) => {
  try {
    const { type, status, limit = 50 } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;

    const jobs = await ImportJob.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit), 200))
      .populate("entityId", "name country")
      .populate("uploadedBy", "name email")
      .lean();
    return res.json(jobs);
  } catch (err) {
    logger.error("import: jobs list failed", { error: err?.message });
    return res.status(500).json({ message: "Failed to fetch jobs" });
  }
});

module.exports = router;
