const express = require("express");
const multer = require("multer");
const gstReconciliationController = require("../controllers/gstReconciliationController");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// GST Reconciliation Endpoints
router.post(
  "/reconciliation/upload",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  upload.single("file"),
  gstReconciliationController.uploadPortalData
);

router.get(
  "/reconciliation/jobs",
  requireAuth,
  roleMiddleware("admin", "accountant", "auditor"),
  gstReconciliationController.getJobs
);

router.get(
  "/reconciliation/jobs/:id",
  requireAuth,
  roleMiddleware("admin", "accountant", "auditor"),
  gstReconciliationController.getJobDetails
);

module.exports = router;
