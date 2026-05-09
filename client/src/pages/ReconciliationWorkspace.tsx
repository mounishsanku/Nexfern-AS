import { useState, useEffect, useCallback } from "react";
import { useLocalization } from "@/context/LocalizationContext";
import { useToast } from "@/context/useToast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { InlineSpinner } from "@/components/ui/Spinner";
import { getApiBase } from "@/api";

interface ReconciliationMatch {
  _id: string;
  sessionId: string;
  leftType: string;
  leftId: string;
  rightType: string;
  rightId: string;
  confidenceScore: number;
  status: "suggested" | "confirmed" | "rejected" | "reversed";
  scoringBreakdown: {
    amountScore: number;
    dateScore: number;
    referenceScore: number;
    invoiceScore: number;
    partyScore: number;
  };
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface ReconciliationSession {
  _id: string;
  type: "bank" | "payment" | "invoice";
  status: string;
  summary: {
    totalCandidates: number;
    matched: number;
    confirmed: number;
    rejected: number;
    unmatched: number;
    discrepancies: number;
  };
  createdAt: string;
  completedAt?: string;
}

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Request failed");
  }
  return res.json();
}

function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 85 ? "bg-emerald-500" : score >= 50 ? "bg-amber-400" : "bg-red-400";
  const label = score >= 85 ? "High" : score >= 50 ? "Medium" : "Low";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-600 dark:text-gray-400 w-16">{label} ({score})</span>
    </div>
  );
}

function ScoreBreakdownTooltip({ breakdown }: { breakdown: ReconciliationMatch["scoringBreakdown"] }) {
  return (
    <div className="text-xs space-y-1 text-gray-600 dark:text-gray-400">
      {Object.entries(breakdown).map(([key, val]) => (
        <div key={key} className="flex justify-between gap-4">
          <span className="capitalize">{key.replace("Score", "")}:</span>
          <span className="font-medium">{val} pts</span>
        </div>
      ))}
    </div>
  );
}

export function ReconciliationWorkspace() {
  const { features } = useLocalization();
  const { success, error: toastError } = useToast();

  const useRecon = features?.USE_ADVANCED_RECONCILIATION === true;

  const [sessions, setSessions] = useState<ReconciliationSession[]>([]);
  const [activeSession, setActiveSession] = useState<ReconciliationSession | null>(null);
  const [matches, setMatches] = useState<ReconciliationMatch[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "suggested" | "confirmed" | "rejected">("suggested");
  const [loading, setLoading] = useState(false);
  const [runningSession, setRunningSession] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("/api/reconciliation/sessions");
      setSessions(data);
      if (data.length > 0 && !activeSession) setActiveSession(data[0]);
    } catch (e) { toastError((e as Error).message); }
    finally { setLoading(false); }
  }, [activeSession]);

  const loadMatches = useCallback(async (sessionId: string) => {
    try {
      const data = await api(`/api/reconciliation/sessions/${sessionId}/matches`);
      setMatches(data);
    } catch (e) { toastError((e as Error).message); }
  }, []);

  useEffect(() => { if (useRecon) loadSessions(); }, [useRecon]);
  useEffect(() => { if (activeSession) loadMatches(activeSession._id); }, [activeSession]);

  const startSession = async () => {
    setRunningSession(true);
    try {
      const session = await api("/api/reconciliation/sessions", { method: "POST", body: JSON.stringify({ type: "bank" }) });
      const result = await api(`/api/reconciliation/sessions/${session._id}/run`, { method: "POST", body: JSON.stringify({}) });
      success(`Reconciliation complete: ${result.summary.matched} matches found`);
      await loadSessions();
      setActiveSession(session);
      await loadMatches(session._id);
    } catch (e) { toastError((e as Error).message); }
    finally { setRunningSession(false); }
  };

  const doAction = async (matchId: string, action: "confirm" | "reject" | "reverse") => {
    setActionLoading(matchId + action);
    try {
      await api(`/api/reconciliation/matches/${matchId}/${action}`, { method: "PATCH" });
      success(`Match ${action}ed`);
      if (activeSession) await loadMatches(activeSession._id);
    } catch (e) { toastError((e as Error).message); }
    finally { setActionLoading(null); }
  };

  const statusVariant = (status: string) => {
    const map: Record<string, "success" | "warning" | "danger" | "neutral"> = {
      confirmed: "success", suggested: "warning", rejected: "danger", reversed: "neutral",
    };
    return map[status] ?? "neutral";
  };

  const filteredMatches = matches.filter(m => activeTab === "all" || m.status === activeTab);

  if (!useRecon) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center min-h-[400px]">
        <div className="w-16 h-16 mb-4 text-gray-300">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">Advanced Reconciliation Disabled</h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-md">
          Enable <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">USE_ADVANCED_RECONCILIATION</code> in company settings to access the reconciliation workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reconciliation Workspace</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Review, confirm, and manage bank reconciliation matches.</p>
        </div>
        <Button variant="primary" onClick={startSession} disabled={runningSession}>
          {runningSession ? <><InlineSpinner /> Running...</> : "Run New Reconciliation"}
        </Button>
      </div>

      {/* Sessions Panel */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">History</h2>
            </div>
            {loading ? (
              <div className="p-4 flex justify-center"><InlineSpinner /></div>
            ) : sessions.length === 0 ? (
              <p className="p-4 text-sm text-gray-500 dark:text-gray-400 text-center">No sessions yet</p>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {sessions.map(s => (
                  <button
                    key={s._id}
                    onClick={() => setActiveSession(s)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${activeSession?._id === s._id ? "bg-blue-50 dark:bg-blue-900/20" : ""}`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">{s.type}</span>
                      <Badge variant={s.status === "completed" ? "success" : "warning"}>{s.status}</Badge>
                    </div>
                    <p className="text-xs text-gray-500">{new Date(s.createdAt).toLocaleDateString()}</p>
                    {s.summary && (
                      <p className="text-xs text-gray-400 mt-1">{s.summary.matched} matched · {s.summary.unmatched} unmatched</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Matches Panel */}
        <div className="col-span-9">
          {activeSession ? (
            <>
              {/* Summary Stats */}
              {activeSession.summary && (
                <div className="grid grid-cols-5 gap-3 mb-4">
                  {[
                    { label: "Candidates", value: activeSession.summary.totalCandidates, color: "text-gray-700 dark:text-gray-300" },
                    { label: "Matched", value: activeSession.summary.matched, color: "text-blue-600" },
                    { label: "Confirmed", value: activeSession.summary.confirmed, color: "text-emerald-600" },
                    { label: "Rejected", value: activeSession.summary.rejected, color: "text-red-500" },
                    { label: "Unmatched", value: activeSession.summary.unmatched, color: "text-amber-500" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-center">
                      <p className={`text-xl font-bold ${color}`}>{value}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Tab Filter */}
              <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
                {(["suggested", "confirmed", "rejected", "all"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${activeTab === tab ? "border-blue-500 text-blue-600 dark:text-blue-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}
                  >
                    {tab} {tab !== "all" && <span className="ml-1 text-xs opacity-70">({matches.filter(m => m.status === tab).length})</span>}
                  </button>
                ))}
              </div>

              {/* Matches List */}
              <div className="space-y-3">
                {filteredMatches.length === 0 ? (
                  <div className="text-center text-gray-500 dark:text-gray-400 py-8">No matches in this category.</div>
                ) : filteredMatches.map(match => (
                  <div key={match._id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div
                      className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30"
                      onClick={() => setExpandedMatch(expandedMatch === match._id ? null : match._id)}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <Badge variant={statusVariant(match.status)}>{match.status}</Badge>
                        <span className="text-sm text-gray-600 dark:text-gray-400 capitalize">{match.leftType} ↔ {match.rightType}</span>
                        {(match.metadata?.leftAmount != null) && (
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            ₹{(match.metadata.leftAmount as number).toLocaleString()}
                          </span>
                        )}
                      </div>
                      <div className="w-48">
                        <ConfidenceBar score={match.confidenceScore} />
                      </div>
                      <div className="flex gap-2 ml-4">
                        {match.status === "suggested" && (
                          <>
                            <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); doAction(match._id, "confirm"); }} disabled={actionLoading === match._id + "confirm"}>
                              {actionLoading === match._id + "confirm" ? <InlineSpinner /> : "Confirm"}
                            </Button>
                            <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); doAction(match._id, "reject"); }} disabled={actionLoading === match._id + "reject"}>
                              Reject
                            </Button>
                          </>
                        )}
                        {match.status === "confirmed" && (
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); doAction(match._id, "reverse"); }} disabled={actionLoading === match._id + "reverse"}>
                            Reverse
                          </Button>
                        )}
                      </div>
                    </div>

                    {expandedMatch === match._id && (
                      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                        <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">Scoring Breakdown</p>
                        <ScoreBreakdownTooltip breakdown={match.scoringBreakdown} />
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500">
                          <span>Left ID: <code className="font-mono">{String(match.leftId).slice(-8)}</code></span>
                          <span>Right ID: <code className="font-mono">{String(match.rightId).slice(-8)}</code></span>
                          <span>Created: {new Date(match.createdAt).toLocaleString()}</span>
                          {match.metadata?.dateDiffMs != null && (
                            <span>Date Δ: {Math.round((match.metadata.dateDiffMs as number) / 86400000)}d</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-16 text-gray-500 dark:text-gray-400">
              Run a reconciliation session to see suggested matches here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
