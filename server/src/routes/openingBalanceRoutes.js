const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { upsertOpeningBalances, listOpeningBalances } = require("../controllers/openingBalanceController");

const router = express.Router();

router.get("/",  requireAuth, roleMiddleware("admin", "accountant", "auditor"), listOpeningBalances);
router.post("/", requireAuth, roleMiddleware("admin"), upsertOpeningBalances);

module.exports = router;
