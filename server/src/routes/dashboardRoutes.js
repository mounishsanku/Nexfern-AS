const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { getDashboard } = require("../controllers/dashboardController");
const { getDashboardSummary, getDashboardMonthly } = require("../controllers/reportController");

const router = express.Router();

const guard = [requireAuth, roleMiddleware("admin", "accountant")];

router.get("/",        ...guard, getDashboard);
router.get("/summary", ...guard, getDashboardSummary);
router.get("/monthly", ...guard, getDashboardMonthly);

module.exports = router;

