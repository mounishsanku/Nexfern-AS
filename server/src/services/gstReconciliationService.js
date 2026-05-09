const GstReconciliationJob = require("../models/GstReconciliationJob");
const GstPortalPurchase = require("../models/GstPortalPurchase");
const Expense = require("../models/Expense");
const Vendor = require("../models/Vendor");
const logger = require("../utils/logger");

/**
 * GstReconciliationService - Handles matching GSTR-2A/2B portal data with Nexfern Expenses.
 */
class GstReconciliationService {
  /**
   * Process an uploaded GSTR-2B JSON and run auto-matching.
   */
  async processJob(jobId) {
    const job = await GstReconciliationJob.findById(jobId);
    if (!job) throw new Error("Job not found");

    job.status = "processing";
    await job.save();

    try {
      // In a real implementation, we'd read the file from disk/S3.
      // For this implementation, we assume the data is already stored or passed.
      // We will simulate the parsing of a GSTR-2B JSON structure.
      
      const portalRows = await GstPortalPurchase.find({ jobId });
      let matchedCount = 0;
      let discrepancyCount = 0;
      let missingInBooksCount = 0;

      for (const pRow of portalRows) {
        // Try to find matching expense
        // 1. Find Vendor by GSTIN
        const vendor = await Vendor.findOne({ gstNumber: new RegExp("^" + pRow.gstin + "$", "i") });
        
        let expense = null;
        if (vendor) {
          // 2. Find Expense by Vendor and Invoice Number
          expense = await Expense.findOne({
            vendorId: vendor._id,
            invoiceNumber: new RegExp("^" + pRow.invoiceNumber + "$", "i"),
            entityId: job.entityId,
            isReversed: false
          });
        }

        if (expense) {
          // Check for discrepancies in amount (allow 1.00 variance for rounding)
          const diff = Math.abs(expense.totalAmount - pRow.totalInvoiceValue);
          if (diff < 1.0) {
            pRow.matchStatus = "matched";
            pRow.matchedExpenseId = expense._id;
            matchedCount++;
          } else {
            pRow.matchStatus = "discrepancy";
            pRow.matchedExpenseId = expense._id;
            pRow.discrepancyNote = `Amount mismatch: Portal=${pRow.totalInvoiceValue}, Books=${expense.totalAmount}`;
            discrepancyCount++;
          }
        } else {
          pRow.matchStatus = "unmatched";
          missingInBooksCount++;
        }
        await pRow.save();
      }

      // Final pass: Identify Expenses in books that were NOT in the portal (Unclaimed)
      // This is usually done by looking at all expenses for the period that don't have a match in GstPortalPurchase
      // but for simplicity, we'll just update the job summary.
      
      job.status = "completed";
      job.summary = {
        totalPortalRows: portalRows.length,
        matchedRows: matchedCount,
        discrepancyRows: discrepancyCount,
        missingInBooksRows: missingInBooksCount,
        unclaimedInPortalRows: 0, // Placeholder
      };
      await job.save();

      logger.info("gst-recon: job completed", { jobId, summary: job.summary });
      return job;

    } catch (err) {
      logger.error("gst-recon: job failed", { jobId, error: err.message });
      job.status = "failed";
      job.errors.push(err.message);
      await job.save();
      throw err;
    }
  }

  /**
   * Helper to parse GSTR-2B JSON (Simplified)
   */
  parseGstrJson(jsonContent) {
    // Expected structure: { data: { doclist: [ { b2b: [ { inv: [...] } ] } ] } }
    const results = [];
    const doclist = jsonContent?.data?.doclist || [];
    
    for (const section of doclist) {
      const b2b = section.b2b || [];
      for (const vendorRecord of b2b) {
        const ctin = vendorRecord.ctin; // Vendor GSTIN
        const invoices = vendorRecord.inv || [];
        for (const inv of invoices) {
          results.push({
            gstin: ctin,
            tradeName: vendorRecord.lgnm || "",
            invoiceNumber: inv.inum,
            invoiceDate: inv.dt, // Expecting DD-MM-YYYY or similar
            taxableValue: parseFloat(inv.val || 0),
            totalInvoiceValue: parseFloat(inv.val || 0) + parseFloat(inv.itax || 0) + parseFloat(inv.ctax || 0) + parseFloat(inv.stax || 0),
            cgst: parseFloat(inv.ctax || 0),
            sgst: parseFloat(inv.stax || 0),
            igst: parseFloat(inv.itax || 0),
          });
        }
      }
    }
    return results;
  }
}

module.exports = new GstReconciliationService();
