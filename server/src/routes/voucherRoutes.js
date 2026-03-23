const express = require("express");
const { requireAuth }            = require("../middleware/authMiddleware");
const roleMiddleware             = require("../middleware/roleMiddleware");
const {
  postVoucher,
  getVouchers,
  getVoucherById,
  reverseVoucher,
} = require("../controllers/voucherController");

const router = express.Router();

// All voucher routes require auth
router.use(requireAuth);

// Attach active year context for guarding on POST
router.post(
  "/",
  roleMiddleware("admin", "accountant"),
  postVoucher
);

router.get(
  "/",
  roleMiddleware("admin", "accountant"),
  getVouchers
);

router.post(
  "/reverse/:voucherId",
  roleMiddleware("admin"),
  reverseVoucher
);

router.get(
  "/:id",
  roleMiddleware("admin", "accountant"),
  getVoucherById
);

module.exports = router;
