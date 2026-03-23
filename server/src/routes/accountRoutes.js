const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { listAccounts, getAccount, createAccount, updateAccount } = require("../controllers/accountController");

const router = express.Router();

router.get("/",    requireAuth, roleMiddleware("admin", "accountant", "auditor"), listAccounts);
router.get("/:id", requireAuth, roleMiddleware("admin", "accountant", "auditor"), getAccount);
router.post("/",   requireAuth, roleMiddleware("admin"), createAccount);
router.put("/:id", requireAuth, roleMiddleware("admin"), updateAccount);

module.exports = router;
