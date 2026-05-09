const GstReconciliationJob = require("../models/GstReconciliationJob");
const GstPortalPurchase = require("../models/GstPortalPurchase");
const gstReconciliationService = require("../services/gstReconciliationService");
const mongoose = require("mongoose");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

/**
 * GstReconciliationController - Handles API endpoints for GST reconciliation.
 */
class GstReconciliationController {
  /**
   * Upload and Stage GSTR-2A/2B data.
   */
  async uploadPortalData(req, res) {
    try {
      const { entityId, sourceType } = req.body;
      const file = req.file;

      if (!file) return res.status(400).json({ message: "No file uploaded" });
      if (!entityId) return res.status(400).json({ message: "entityId is required" });

      const content = JSON.parse(file.buffer.toString());
      const parsedRows = gstReconciliationService.parseGstrJson(content);

      if (parsedRows.length === 0) {
        return res.status(400).json({ message: "No valid B2B records found in JSON" });
      }

      const job = new GstReconciliationJob({
        entityId,
        uploadedBy: req.user.sub,
        fileName: file.originalname,
        sourceType: sourceType || "2B",
        status: "pending",
      });

      await job.save();

      // Bulk insert portal records
      const portalRecords = parsedRows.map(row => ({
        ...row,
        jobId: job._id,
        entityId,
      }));

      await GstPortalPurchase.insertMany(portalRecords);

      // Trigger matching asynchronously
      gstReconciliationService.processJob(job._id).catch(err => {
        console.error("GstMatch Background Error:", err);
      });

      return res.status(201).json(job);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Failed to process GSTR upload" });
    }
  }

  /**
   * Get all reconciliation jobs for an entity.
   */
  async getJobs(req, res) {
    try {
      const { entityId } = req.query;
      const filter = entityId ? { entityId } : {};
      const jobs = await GstReconciliationJob.find(filter).sort({ createdAt: -1 });
      return res.json(jobs);
    } catch (err) {
      return res.status(500).json({ message: "Failed to fetch jobs" });
    }
  }

  /**
   * Get specific job details and matches.
   */
  async getJobDetails(req, res) {
    try {
      const { id } = req.params;
      const job = await GstReconciliationJob.findById(id).lean();
      if (!job) return res.status(404).json({ message: "Job not found" });

      const rows = await GstPortalPurchase.find({ jobId: id }).populate("matchedExpenseId").lean();
      return res.json({ job, rows });
    } catch (err) {
      return res.status(500).json({ message: "Failed to fetch job details" });
    }
  }
}

module.exports = new GstReconciliationController();
