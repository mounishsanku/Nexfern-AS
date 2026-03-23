const express = require("express");

const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { getAuditLogs, exportAuditCsv } = require("../controllers/auditController");

const router = express.Router();

// Admin/auditor can view audit logs
router.get("/",      requireAuth, roleMiddleware("admin", "auditor"), getAuditLogs);
router.get("/logs",  requireAuth, roleMiddleware("admin", "auditor"), getAuditLogs);
router.get("/export", requireAuth, roleMiddleware("admin", "auditor"), exportAuditCsv);

module.exports = router;

