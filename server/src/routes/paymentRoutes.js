const express = require("express");

const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { safeExecute } = require("../middleware/safeExecuteMiddleware");
const { preTransactionGuard } = require("../middleware/preTransactionGuard");
const { createPayment, getPayments, updatePayment, deletePayment } = require("../controllers/paymentController");

const router = express.Router();

router.post(
  "/",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  preTransactionGuard,
  safeExecute(createPayment),
);
router.get("/:invoiceId",  requireAuth, roleMiddleware("admin", "accountant", "receptionist", "auditor"), safeExecute(getPayments));
router.put("/by-id/:id",   requireAuth, roleMiddleware("admin", "accountant"), safeExecute(updatePayment));
router.delete("/by-id/:id", requireAuth, roleMiddleware("admin", "accountant"), safeExecute(deletePayment));

module.exports = router;

