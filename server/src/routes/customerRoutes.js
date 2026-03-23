const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const {
  createCustomer,
  getCustomers,
} = require("../controllers/customerController");

const router = express.Router();

router.get("/", requireAuth, roleMiddleware("admin", "accountant", "receptionist", "auditor"), getCustomers);
router.post("/", requireAuth, roleMiddleware("admin", "accountant", "receptionist"), createCustomer);

module.exports = router;

