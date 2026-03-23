const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const {
  getSystemDiagnostics,
  getSystemValidate,
  getFullSystemDiagnostic,
  postBackup,
  postRestore,
} = require("../controllers/systemDiagnosticsController");

const router = express.Router();

router.get(
  "/diagnostics",
  requireAuth,
  roleMiddleware("admin", "accountant", "auditor"),
  getSystemDiagnostics,
);

router.get(
  "/validate",
  requireAuth,
  roleMiddleware("admin", "accountant", "auditor"),
  getSystemValidate,
);

router.get(
  "/full-diagnostic",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  getFullSystemDiagnostic,
);

router.post(
  "/backup",
  requireAuth,
  roleMiddleware("admin"),
  postBackup,
);

router.post(
  "/restore",
  requireAuth,
  roleMiddleware("admin"),
  postRestore,
);

module.exports = router;
