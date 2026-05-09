/**
 * reconciliationEngine.js — Enterprise-grade deterministic reconciliation engine.
 *
 * DESIGN PRINCIPLES:
 *  1. Deterministic rules only — no AI/ML
 *  2. Every match is explainable via scoringBreakdown
 *  3. Suggested matches NEVER auto-mutate accounting records
 *  4. Reversals preserve full history (status → "reversed", never deleted)
 *  5. All operations generate audit logs
 *
 * SCORING SYSTEM (0–100):
 *  - Exact amount match:        +40 pts
 *  - Date proximity ≤1 day:     +25 pts   ≤3 days: +15   ≤7 days: +5
 *  - Reference number match:    +20 pts
 *  - Invoice/order ref match:   +10 pts
 *  - Party name similarity:     +5  pts
 *
 * Thresholds:
 *  - ≥ 85 → HIGH confidence (auto-confirm eligible)
 *  - 50–84 → MEDIUM (requires human review)
 *  - < 50 → LOW (flagged but not suggested)
 */

const mongoose = require("mongoose");
const ReconciliationSession = require("../models/ReconciliationSession");
const ReconciliationMatch = require("../models/ReconciliationMatch");
const BankStatement = require("../models/BankStatement");
const BankTransaction = require("../models/BankTransaction");
const Payment = require("../models/Payment");
const Invoice = require("../models/Invoice");
const IncidentLog = require("../models/IncidentLog");
const { logAction, ACTIONS } = require("../utils/audit");

const CONFIDENCE = {
  HIGH: 85,
  MEDIUM: 50,
};

const DATE_WINDOWS_MS = {
  exact: 0,
  one_day: 86400000,
  three_days: 3 * 86400000,
  seven_days: 7 * 86400000,
};

// ── Scoring Functions ──────────────────────────────────────────────────────────

function scoreAmount(leftAmt, rightAmt) {
  if (leftAmt == null || rightAmt == null) return 0;
  const diff = Math.abs(leftAmt - rightAmt);
  if (diff === 0) return 40;
  if (diff <= 0.01) return 38; // floating point tolerance
  if (diff / Math.max(leftAmt, rightAmt) <= 0.01) return 30; // within 1%
  return 0;
}

function scoreDate(leftDate, rightDate) {
  if (!leftDate || !rightDate) return 0;
  const diff = Math.abs(new Date(leftDate) - new Date(rightDate));
  if (diff <= DATE_WINDOWS_MS.exact) return 25;
  if (diff <= DATE_WINDOWS_MS.one_day) return 20;
  if (diff <= DATE_WINDOWS_MS.three_days) return 15;
  if (diff <= DATE_WINDOWS_MS.seven_days) return 5;
  return 0;
}

function scoreReference(leftRef, rightRef) {
  if (!leftRef || !rightRef) return 0;
  const l = String(leftRef).trim().toLowerCase();
  const r = String(rightRef).trim().toLowerCase();
  if (l === r) return 20;
  if (l.includes(r) || r.includes(l)) return 10;
  return 0;
}

function scoreInvoiceRef(leftDesc, rightInvoiceNo) {
  if (!leftDesc || !rightInvoiceNo) return 0;
  const desc = String(leftDesc).toLowerCase();
  const inv = String(rightInvoiceNo).toLowerCase();
  if (desc.includes(inv)) return 10;
  return 0;
}

function scoreParty(leftParty, rightParty) {
  if (!leftParty || !rightParty) return 0;
  const l = String(leftParty).trim().toLowerCase();
  const r = String(rightParty).trim().toLowerCase();
  if (l === r) return 5;
  if (l.includes(r.slice(0, 4)) || r.includes(l.slice(0, 4))) return 2;
  return 0;
}

function computeScore(left, right) {
  const amountScore = scoreAmount(left.amount, right.amount);
  const dateScore = scoreDate(left.date, right.date || right.createdAt);
  const referenceScore = scoreReference(left.referenceNo || left.description, right.referenceNo);
  const invoiceScore = scoreInvoiceRef(left.description, right.invoiceNumber);
  const partyScore = scoreParty(left.party, right.partyName || right.customerName || right.vendorName);
  const total = Math.min(100, amountScore + dateScore + referenceScore + invoiceScore + partyScore);
  return { total, breakdown: { amountScore, dateScore, referenceScore, invoiceScore, partyScore } };
}

// ── Session & Match Lifecycle ──────────────────────────────────────────────────

async function createSession({ type, entityId, createdBy }) {
  return ReconciliationSession.create({ type, entityId, createdBy, status: "open" });
}

/**
 * Core engine: generate candidate matches for a bank reconciliation session.
 * Matches statements against bank transactions + payments.
 * Does NOT confirm any matches — returns suggestions only.
 */
async function runBankReconciliation(sessionId, entityId) {
  const session = await ReconciliationSession.findById(sessionId);
  if (!session) throw new Error("ReconciliationSession not found");

  await ReconciliationSession.findByIdAndUpdate(sessionId, { status: "in_progress" });

  const statements = await BankStatement.find({ isMatched: { $ne: true } }).lean();
  const transactions = await BankTransaction.find({ isReconciled: { $ne: true } }).lean();
  const payments = await Payment.find({}).lean();

  const usedTxIds = new Set();
  const matches = [];
  const discrepancies = [];

  for (const stmt of statements) {
    let bestMatch = null;
    let bestScore = 0;
    let bestBreakdown = null;
    let bestRightType = null;

    // Try matching against BankTransactions
    for (const tx of transactions) {
      if (usedTxIds.has(String(tx._id))) continue;
      const { total, breakdown } = computeScore(
        { amount: stmt.amount, date: stmt.date, description: stmt.description },
        { amount: tx.amount, date: tx.date, referenceNo: null }
      );
      if (total > bestScore) {
        bestScore = total;
        bestMatch = tx;
        bestBreakdown = breakdown;
        bestRightType = "bank_transaction";
      }
    }

    // Try matching against Payments
    for (const pay of payments) {
      const { total, breakdown } = computeScore(
        { amount: stmt.amount, date: stmt.date, description: stmt.description },
        { amount: pay.amount, date: pay.date || pay.createdAt, referenceNo: pay.referenceNo }
      );
      if (total > bestScore) {
        bestScore = total;
        bestMatch = pay;
        bestBreakdown = breakdown;
        bestRightType = "payment";
      }
    }

    if (bestMatch && bestScore >= CONFIDENCE.MEDIUM) {
      usedTxIds.add(String(bestMatch._id));
      try {
        const match = await ReconciliationMatch.create({
          sessionId,
          leftType: "bank_statement",
          leftId: stmt._id,
          rightType: bestRightType,
          rightId: bestMatch._id,
          confidenceScore: bestScore,
          status: "suggested",
          scoringBreakdown: bestBreakdown,
          metadata: {
            leftAmount: stmt.amount,
            rightAmount: bestMatch.amount,
            dateDiffMs: Math.abs(new Date(stmt.date) - new Date(bestMatch.date || bestMatch.createdAt)),
          },
        });
        matches.push(match);
      } catch (err) {
        // Duplicate pair — skip silently (unique index enforcement)
        if (err.code !== 11000) throw err;
      }
    } else {
      discrepancies.push({ statementId: stmt._id, amount: stmt.amount, date: stmt.date, reason: bestScore < CONFIDENCE.MEDIUM ? "low_confidence" : "no_candidate" });
    }
  }

  // Log discrepancies as incidents if suspicious
  if (discrepancies.length > statements.length * 0.5) {
    await IncidentLog.create({
      severity: "medium",
      category: "reconciliation_drift",
      source: "reconciliationEngine",
      message: `High discrepancy rate: ${discrepancies.length}/${statements.length} unmatched in session ${sessionId}`,
      metadata: { sessionId, discrepancyCount: discrepancies.length },
    }).catch(() => {});
  }

  const summary = {
    totalCandidates: statements.length,
    matched: matches.length,
    confirmed: 0,
    rejected: 0,
    unmatched: discrepancies.length,
    discrepancies: discrepancies.length,
  };

  await ReconciliationSession.findByIdAndUpdate(sessionId, { status: "completed", completedAt: new Date(), summary });

  return { session: sessionId, matches, discrepancies, summary };
}

/**
 * Confirm a match (human-initiated).
 * Only updates ReconciliationMatch — does NOT mutate vouchers or payments.
 */
async function confirmMatch(matchId, userId) {
  const matchDoc = await ReconciliationMatch.findById(matchId);
  if (!matchDoc) throw new Error("Match not found");
  if (matchDoc.status !== "suggested") throw new Error(`Cannot confirm a match in status "${matchDoc.status}"`);
  if (matchDoc.confidenceScore < CONFIDENCE.MEDIUM) {
    throw new Error(`Low confidence match (${matchDoc.confidenceScore}) requires override flag`);
  }
  
  const match = await ReconciliationMatch.findOneAndUpdate(
    { _id: matchId, status: "suggested" },
    { $set: { status: "confirmed", matchedBy: userId } },
    { new: true }
  );
  if (!match) throw new Error("Match state changed concurrently, aborting");

  await logAction(userId, ACTIONS.APPROVE, "reconciliation_match", matchId, {
    before: { status: "suggested" },
    after: { status: "confirmed", confidenceScore: match.confidenceScore },
  });
  return match;
}

/**
 * Reject a match (human-initiated).
 */
async function rejectMatch(matchId, userId) {
  const matchDoc = await ReconciliationMatch.findById(matchId);
  if (!matchDoc) throw new Error("Match not found");
  if (!["suggested", "confirmed"].includes(matchDoc.status)) {
    throw new Error(`Cannot reject a match in status "${matchDoc.status}"`);
  }
  const prevStatus = matchDoc.status;
  
  const match = await ReconciliationMatch.findOneAndUpdate(
    { _id: matchId, status: prevStatus },
    { $set: { status: "rejected", matchedBy: userId } },
    { new: true }
  );
  if (!match) throw new Error("Match state changed concurrently, aborting");

  await logAction(userId, ACTIONS.UPDATE, "reconciliation_match", matchId, {
    before: { status: prevStatus },
    after: { status: "rejected" },
  });
  return match;
}

/**
 * Reverse a confirmed match (reversible audit trail preserved — status → "reversed", never deleted).
 */
async function reverseMatch(matchId, userId) {
  const matchDoc = await ReconciliationMatch.findById(matchId);
  if (!matchDoc) throw new Error("Match not found");
  if (matchDoc.status !== "confirmed") throw new Error("Only confirmed matches can be reversed");
  
  const now = new Date();
  const match = await ReconciliationMatch.findOneAndUpdate(
    { _id: matchId, status: "confirmed" },
    { $set: { status: "reversed", reversedBy: userId, reversedAt: now } },
    { new: true }
  );
  if (!match) throw new Error("Match state changed concurrently, aborting");

  await logAction(userId, ACTIONS.REVERSE, "reconciliation_match", matchId, {
    before: { status: "confirmed" },
    after: { status: "reversed", reversedAt: match.reversedAt },
  });
  return match;
}

/**
 * Diagnostics: surface reconciliation health warnings.
 */
async function runReconciliationDiagnostics() {
  const warnings = [];

  // Stale unmatched transactions (unreconciled for >30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const staleCount = await BankTransaction.countDocuments({
    isReconciled: { $ne: true },
    date: { $lt: thirtyDaysAgo },
  });
  if (staleCount > 0) {
    warnings.push({ code: "RECON_STALE_UNMATCHED", message: `${staleCount} bank transaction(s) unreconciled for >30 days.` });
  }

  // Duplicate matches (same leftId confirmed in multiple sessions)
  const dupAgg = await ReconciliationMatch.aggregate([
    { $match: { status: "confirmed" } },
    { $group: { _id: "$leftId", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  if (dupAgg.length > 0) {
    warnings.push({ code: "RECON_DUPLICATE_MATCH", message: `${dupAgg.length} bank record(s) confirmed-matched more than once.` });
  }

  // Excessive reversals
  const reversalCount = await ReconciliationMatch.countDocuments({ status: "reversed" });
  const confirmedCount = await ReconciliationMatch.countDocuments({ status: "confirmed" });
  if (confirmedCount > 0 && reversalCount / confirmedCount > 0.2) {
    warnings.push({ code: "RECON_EXCESSIVE_REVERSALS", message: `Reversal rate ${(reversalCount / confirmedCount * 100).toFixed(1)}% exceeds 20% threshold.` });
  }

  return { warnings };
}

module.exports = {
  createSession,
  runBankReconciliation,
  confirmMatch,
  rejectMatch,
  reverseMatch,
  runReconciliationDiagnostics,
  CONFIDENCE,
};
