const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const {
  createProject,
  listProjects,
  completeProjectMilestone,
  createBatch,
  listBatches,
  addBatchStudent,
  payBatchStudent,
  createEvent,
  listEvents,
  buyEventTicket,
} = require("../controllers/revenueSourceController");

const router = express.Router();

router.get("/projects", requireAuth, roleMiddleware("admin", "accountant", "auditor"), listProjects);
router.post("/projects", requireAuth, roleMiddleware("admin", "accountant"), createProject);
router.post(
  "/projects/:id/milestones/:milestoneId/complete",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  completeProjectMilestone,
);

router.get("/batches", requireAuth, roleMiddleware("admin", "accountant", "auditor"), listBatches);
router.post("/batches", requireAuth, roleMiddleware("admin", "accountant"), createBatch);
router.post("/batches/:id/students", requireAuth, roleMiddleware("admin", "accountant"), addBatchStudent);
router.post(
  "/batches/:id/students/:studentId/pay",
  requireAuth,
  roleMiddleware("admin", "accountant"),
  payBatchStudent,
);

router.get("/events", requireAuth, roleMiddleware("admin", "accountant", "auditor"), listEvents);
router.post("/events", requireAuth, roleMiddleware("admin", "accountant"), createEvent);
router.post(
  "/events/:id/buy-ticket",
  requireAuth,
  roleMiddleware("admin", "accountant", "receptionist"),
  buyEventTicket,
);

module.exports = router;
