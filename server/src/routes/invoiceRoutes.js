const express = require("express");
const {
  createInvoice,
  getAllInvoices,
  getInvoicePdf,
  updateInvoice,
  deleteInvoice,
  generateEInvoice,
} = require("../controllers/invoiceController");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { getPayments } = require("../controllers/paymentController");

const router = express.Router();

// Protected: only authenticated users can access invoice endpoints.
router.post("/",             requireAuth, roleMiddleware("admin", "accountant", "receptionist"), createInvoice);
router.get("/",              requireAuth, roleMiddleware("admin", "accountant", "receptionist", "auditor"), getAllInvoices);
router.put("/:id",           requireAuth, roleMiddleware("admin", "accountant"), updateInvoice);
router.delete("/:id",        requireAuth, roleMiddleware("admin", "accountant"), deleteInvoice);
router.get("/:id/payments",  requireAuth, roleMiddleware("admin", "accountant", "receptionist", "auditor"), getPayments);
router.get("/:id/pdf",       requireAuth, roleMiddleware("admin", "accountant", "receptionist", "auditor"), getInvoicePdf);
router.post("/:id/einvoice",  requireAuth, roleMiddleware("admin", "accountant"), generateEInvoice);

module.exports = router;

