const express = require("express");
const { recognizeRevenue, getSchedules } = require("../controllers/revenueController");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { safeExecute } = require("../middleware/safeExecuteMiddleware");
const { preTransactionGuard } = require("../middleware/preTransactionGuard");
const router = express.Router();

router.post(
  "/recognize",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  preTransactionGuard,
  safeExecute(recognizeRevenue)
);


router.get(
  "/schedules",
  requireAuth,
  roleMiddleware("admin", "accountant", "auditor"),
  safeExecute(getSchedules)
);

module.exports = router;
