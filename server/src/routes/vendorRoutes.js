const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware  = require("../middleware/roleMiddleware");
const { createVendor, listVendors } = require("../controllers/vendorController");

const router = express.Router();

router.post("/", requireAuth, roleMiddleware("admin", "accountant"), createVendor);
router.get("/",  requireAuth, roleMiddleware("admin", "accountant", "auditor"), listVendors);

module.exports = router;
