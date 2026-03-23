const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { buyEventTicket } = require("../controllers/revenueSourceController");

const router = express.Router();

router.post(
  "/:id/buy-ticket",
  requireAuth,
  roleMiddleware("admin", "accountant", "receptionist"),
  buyEventTicket,
);

module.exports = router;
