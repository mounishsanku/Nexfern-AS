const express = require("express");

const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { getTrialBalance } = require("../controllers/reportController");

const router = express.Router();

router.get("/", requireAuth, roleMiddleware("admin", "accountant"), getTrialBalance);

module.exports = router;

