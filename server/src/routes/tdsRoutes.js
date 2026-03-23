const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { safeExecute } = require("../middleware/safeExecuteMiddleware");
const { preTransactionGuard } = require("../middleware/preTransactionGuard");
const { getTdsApiInfo, getTdsReport, payTds } = require("../controllers/tdsController");

const router = express.Router();

router.get("/", requireAuth, roleMiddleware("admin", "accountant", "auditor"), safeExecute(getTdsApiInfo));
router.get("/report", requireAuth, roleMiddleware("admin", "accountant", "auditor"), safeExecute(getTdsReport));
router.post(
  "/pay",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  preTransactionGuard,
  safeExecute(payTds)
);


module.exports = router;
