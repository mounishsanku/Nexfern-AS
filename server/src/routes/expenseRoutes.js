const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { requireActiveYear, guardClosedYear } = require("../middleware/financialYearMiddleware");
const { safeExecute } = require("../middleware/safeExecuteMiddleware");
const { preTransactionGuard } = require("../middleware/preTransactionGuard");
const {
  createExpense,
  getExpenses,
  runRecurring,
  updateExpense,
  deleteExpense,
  approveExpense,
  rejectExpense,
  uploadAttachment,
} = require("../controllers/expenseController");

const uploadDir = path.join(__dirname, "../../uploads/expenses");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, "_").slice(0, 40);
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, /jpeg|jpg|png|pdf|webp/i.test(path.extname(file.originalname)));
  },
});

const router = express.Router();

// Static paths before /:id to avoid param shadowing
router.post(
  "/upload",
  requireAuth,
  roleMiddleware("admin", "accountant", "receptionist"),
  upload.single("file"),
  safeExecute(uploadAttachment),
);
router.post("/", requireAuth, roleMiddleware("admin", "accountant", "receptionist"), safeExecute(createExpense));
router.post(
  "/run-recurring",
  requireAuth,
  requireActiveYear,
  guardClosedYear,
  roleMiddleware("admin", "accountant"),
  safeExecute(runRecurring),
);
router.get("/", requireAuth, roleMiddleware("admin", "accountant", "auditor", "receptionist"), safeExecute(getExpenses));
router.post(
  "/:id/approve",
  requireAuth,
  requireActiveYear,
  guardClosedYear,
  roleMiddleware("admin", "accountant"),
  preTransactionGuard,
  safeExecute(approveExpense),
);
router.post(
  "/:id/reject",
  requireAuth,
  requireActiveYear,
  guardClosedYear,
  roleMiddleware("admin", "accountant"),
  safeExecute(rejectExpense),
);
router.put("/:id", requireAuth, roleMiddleware("admin", "accountant"), safeExecute(updateExpense));
router.delete("/:id", requireAuth, roleMiddleware("admin", "accountant"), safeExecute(deleteExpense));

module.exports = router;
