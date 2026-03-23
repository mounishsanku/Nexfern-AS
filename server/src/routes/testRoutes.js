const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { getTest } = require("../controllers/testController");

const router = express.Router();

router.get("/test", requireAuth, roleMiddleware("admin"), getTest);

module.exports = router;

