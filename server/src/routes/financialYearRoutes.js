const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware  = require("../middleware/roleMiddleware");
const {
  createYear,
  listYears,
  closeYear,
  getYear,
} = require("../controllers/financialYearController");

const router = express.Router();

// Admin: create and close years
router.post(
  "/",
  requireAuth,
  roleMiddleware("admin"),
  createYear
);

router.get(
  "/",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  listYears
);

router.get(
  "/:id",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  getYear
);

router.post(
  "/close/:id",
  requireAuth,
  roleMiddleware("admin"),
  closeYear
);

module.exports = router;
