/**
 * reconciliationRoutes.js — REST API for the Advanced Reconciliation Engine.
 * Admin + Accountant only. Suggested matches are read-only until confirmed by a human.
 */
const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");
const {
  createSession,
  runBankReconciliation,
  confirmMatch,
  rejectMatch,
  reverseMatch,
  runReconciliationDiagnostics,
} = require("../services/reconciliationEngine");
const ReconciliationSession = require("../models/ReconciliationSession");
const ReconciliationMatch = require("../models/ReconciliationMatch");

router.use(requireAuth);
router.use(roleMiddleware("admin", "accountant"));

// POST /api/reconciliation/sessions — start a new session
router.post("/sessions", async (req, res) => {
  try {
    const { type = "bank", entityId } = req.body;
    const userId = req.user?.sub ?? req.user?.id;
    const session = await createSession({ type, entityId, createdBy: userId });
    res.status(201).json(session);
  } catch (err) {
    return sendStructuredError(res, { status: 400, code: "RECON_SESSION_FAILED", message: err.message, action: ACTION.FIX_REQUIRED });
  }
});

// GET /api/reconciliation/sessions — list all sessions
router.get("/sessions", async (req, res) => {
  try {
    const sessions = await ReconciliationSession.find().sort({ createdAt: -1 }).limit(50).lean();
    res.json(sessions);
  } catch (err) {
    return sendStructuredError(res, { status: 503, code: "RECON_LIST_FAILED", message: err.message, action: ACTION.RETRY });
  }
});

// POST /api/reconciliation/sessions/:id/run — run bank reconciliation engine for a session
router.post("/sessions/:id/run", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await runBankReconciliation(id, req.body?.entityId);
    res.json(result);
  } catch (err) {
    return sendStructuredError(res, { status: 503, code: "RECON_RUN_FAILED", message: err.message, action: ACTION.RETRY });
  }
});

// GET /api/reconciliation/sessions/:id/matches — get matches for a session
router.get("/sessions/:id/matches", async (req, res) => {
  try {
    const matches = await ReconciliationMatch.find({ sessionId: req.params.id }).sort({ confidenceScore: -1 }).lean();
    res.json(matches);
  } catch (err) {
    return sendStructuredError(res, { status: 503, code: "RECON_MATCHES_FAILED", message: err.message, action: ACTION.RETRY });
  }
});

// PATCH /api/reconciliation/matches/:id/confirm — human confirms a suggested match
router.patch("/matches/:id/confirm", async (req, res) => {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const match = await confirmMatch(req.params.id, userId);
    res.json(match);
  } catch (err) {
    return sendStructuredError(res, { status: 400, code: "RECON_CONFIRM_FAILED", message: err.message, action: ACTION.FIX_REQUIRED });
  }
});

// PATCH /api/reconciliation/matches/:id/reject — human rejects a suggested match
router.patch("/matches/:id/reject", async (req, res) => {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const match = await rejectMatch(req.params.id, userId);
    res.json(match);
  } catch (err) {
    return sendStructuredError(res, { status: 400, code: "RECON_REJECT_FAILED", message: err.message, action: ACTION.FIX_REQUIRED });
  }
});

// PATCH /api/reconciliation/matches/:id/reverse — reverse a confirmed match (audit trail preserved)
router.patch("/matches/:id/reverse", async (req, res) => {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const match = await reverseMatch(req.params.id, userId);
    res.json(match);
  } catch (err) {
    return sendStructuredError(res, { status: 400, code: "RECON_REVERSE_FAILED", message: err.message, action: ACTION.FIX_REQUIRED });
  }
});

// GET /api/reconciliation/diagnostics — surface reconciliation health
router.get("/diagnostics", async (req, res) => {
  try {
    const result = await runReconciliationDiagnostics();
    res.json(result);
  } catch (err) {
    return sendStructuredError(res, { status: 503, code: "RECON_DIAG_FAILED", message: err.message, action: ACTION.RETRY });
  }
});

module.exports = router;
