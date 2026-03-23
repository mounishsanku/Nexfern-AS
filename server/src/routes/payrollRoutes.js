const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { safeExecute } = require("../middleware/safeExecuteMiddleware");
const { preTransactionGuard } = require("../middleware/preTransactionGuard");
const {
  createEmployee,
  getEmployees,
  runPayroll,
  getPayroll,
  getPayrollSummary,
} = require("../controllers/payrollController");

const router = express.Router();

router.get("/", requireAuth, roleMiddleware("admin", "accountant", "auditor"), safeExecute(getPayroll));
router.get("/summary", requireAuth, roleMiddleware("admin", "accountant", "auditor"), safeExecute(getPayrollSummary));
router.post(
  "/run",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  preTransactionGuard,
  safeExecute(runPayroll)
);

router.get("/employees", requireAuth, roleMiddleware("admin", "accountant", "auditor"), safeExecute(getEmployees));
router.post("/employees", requireAuth, roleMiddleware("admin", "accountant"), safeExecute(createEmployee));

module.exports = router;
