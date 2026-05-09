import * as React from "react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { InlineSpinner } from "@/components/ui/Spinner";
import { useToast } from "@/context/useToast";
import { apiFetch, getStoredToken } from "@/api";

type JobSummary = {
  totalPortalRows: number;
  matchedRows: number;
  discrepancyRows: number;
  missingInBooksRows: number;
  unclaimedInPortalRows: number;
};

type ReconJob = {
  _id: string;
  fileName: string;
  sourceType: "2A" | "2B";
  status: "pending" | "processing" | "completed" | "failed";
  summary: JobSummary;
  createdAt: string;
};

type PortalRow = {
  _id: string;
  gstin: string;
  tradeName: string;
  invoiceNumber: string;
  taxableValue: number;
  totalInvoiceValue: number;
  matchStatus: "matched" | "unmatched" | "discrepancy";
  discrepancyNote?: string;
  matchedExpenseId?: {
    _id: string;
    title: string;
    totalAmount: number;
  };
};

export function GstReconciliation() {
  const { success, error: toastError } = useToast();
  const [jobs, setJobs] = React.useState<ReconJob[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);
  const [jobDetails, setJobDetails] = React.useState<{ job: ReconJob; rows: PortalRow[] } | null>(null);
  const [loadingDetails, setLoadingDetails] = React.useState(false);

  const token = getStoredToken();

  const fetchJobs = React.useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiFetch<ReconJob[]>("/gst/reconciliation/jobs", { token });
      setJobs(data);
    } catch (err) {
      toastError("Failed to fetch reconciliation jobs");
    } finally {
      setLoading(false);
    }
  }, [token, toastError]);

  const fetchJobDetails = React.useCallback(async (id: string) => {
    if (!token) return;
    setLoadingDetails(true);
    try {
      const data = await apiFetch<{ job: ReconJob; rows: PortalRow[] }>(`/gst/reconciliation/jobs/${id}`, { token });
      setJobDetails(data);
      setSelectedJobId(id);
    } catch (err) {
      toastError("Failed to fetch job details");
    } finally {
      setLoadingDetails(false);
    }
  }, [token, toastError]);

  React.useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("entityId", "64f123456789012345678901"); // Placeholder, in real app get from context
    formData.append("sourceType", "2B");

    try {
      // Note: apiFetch usually handles JSON. For multipart, we might need a raw fetch or update apiFetch.
      const response = await fetch(`${import.meta.env.VITE_API_BASE || ""}/api/gst/reconciliation/upload`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`
        },
        body: formData
      });

      if (!response.ok) throw new Error("Upload failed");

      success("GSTR-2B uploaded. Auto-matching started.");
      fetchJobs();
    } catch (err) {
      toastError("Upload failed. Ensure file is valid GSTR JSON.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Container className="py-8">
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        {/* Left Panel: Jobs List */}
        <div className="w-full md:w-80 shrink-0 space-y-4">
          <div className="rounded-2xl bg-white p-6 shadow-soft ring-1 ring-slate-200">
            <h2 className="text-lg font-bold text-slate-900">GST Reconciliation</h2>
            <p className="mt-1 text-sm text-slate-500">Auto-match GSTR-2A/2B with Books</p>

            <div className="mt-6">
              <label className="group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-4 transition-colors hover:border-primary/50 hover:bg-slate-50">
                {uploading ? (
                  <InlineSpinner className="h-6 w-6 text-primary" />
                ) : (
                  <>
                    <svg className="h-6 w-6 text-slate-400 group-hover:text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="mt-2 text-xs font-semibold text-slate-600">Upload GSTR JSON</span>
                  </>
                )}
                <input type="file" className="sr-only" accept=".json" onChange={handleFileUpload} disabled={uploading} />
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Recent Jobs</h3>
            {loading ? (
              <div className="py-4 text-center"><InlineSpinner /></div>
            ) : jobs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">No jobs yet</div>
            ) : (
              jobs.map(job => (
                <button
                  key={job._id}
                  onClick={() => fetchJobDetails(job._id)}
                  className={`w-full rounded-xl p-3 text-left transition-all ${selectedJobId === job._id ? 'bg-primary text-white shadow-lg' : 'bg-white hover:bg-slate-50 ring-1 ring-slate-200'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate text-sm font-bold">{job.fileName}</span>
                    <Badge variant={job.status === "completed" ? "success" : "warning"} className={selectedJobId === job._id ? 'bg-white/20 text-white' : ''}>
                      {job.status}
                    </Badge>
                  </div>
                  <div className={`mt-1 text-[10px] ${selectedJobId === job._id ? 'text-white/80' : 'text-slate-400'}`}>
                    {new Date(job.createdAt).toLocaleDateString()} · {job.sourceType}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Panel: Job Details & Report */}
        <div className="flex-1 min-w-0">
          {loadingDetails ? (
            <div className="flex h-64 items-center justify-center rounded-2xl bg-white shadow-soft ring-1 ring-slate-200">
              <InlineSpinner className="h-8 w-8 text-primary" />
            </div>
          ) : jobDetails ? (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatCard label="Total Portal Rows" value={jobDetails.job.summary.totalPortalRows} color="text-slate-600" />
                <StatCard label="Matched" value={jobDetails.job.summary.matchedRows} color="text-emerald-600" />
                <StatCard label="Discrepancies" value={jobDetails.job.summary.discrepancyRows} color="text-amber-500" />
                <StatCard label="Missing in Books" value={jobDetails.job.summary.missingInBooksRows} color="text-rose-500" />
              </div>

              {/* Data Table */}
              <div className="overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-slate-200">
                <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4 flex items-center justify-between">
                  <h3 className="font-bold text-slate-800">Reconciliation Report</h3>
                  <Button variant="secondary" size="sm">Export CSV</Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/30 text-slate-500">
                        <th className="px-6 py-3 font-semibold uppercase tracking-wider">GSTIN / Vendor</th>
                        <th className="px-6 py-3 font-semibold uppercase tracking-wider">Invoice #</th>
                        <th className="px-6 py-3 font-semibold uppercase tracking-wider">Portal Val</th>
                        <th className="px-6 py-3 font-semibold uppercase tracking-wider">Books Val</th>
                        <th className="px-6 py-3 font-semibold uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {jobDetails.rows.map(row => (
                        <tr key={row._id} className="group hover:bg-slate-50/50">
                          <td className="px-6 py-4">
                            <div className="font-bold text-slate-900">{row.gstin}</div>
                            <div className="text-xs text-slate-500">{row.tradeName}</div>
                          </td>
                          <td className="px-6 py-4 font-mono text-xs">{row.invoiceNumber}</td>
                          <td className="px-6 py-4 font-semibold">₹{row.totalInvoiceValue.toLocaleString()}</td>
                          <td className="px-6 py-4">
                            {row.matchedExpenseId ? (
                              <span className="font-semibold text-slate-700">₹{row.matchedExpenseId.totalAmount.toLocaleString()}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col gap-1">
                              <Badge variant={row.matchStatus === "matched" ? "success" : row.matchStatus === "discrepancy" ? "warning" : "danger"}>
                                {row.matchStatus}
                              </Badge>
                              {row.discrepancyNote && (
                                <div className="max-w-[200px] truncate text-[10px] text-amber-600" title={row.discrepancyNote}>
                                  {row.discrepancyNote}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-96 flex-col items-center justify-center rounded-2xl bg-white p-8 text-center shadow-soft ring-1 ring-slate-200">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 text-slate-300">
                <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-bold text-slate-900">No Job Selected</h3>
              <p className="mt-2 text-sm text-slate-500">Upload a GSTR JSON file or select a job from the history to view the reconciliation report.</p>
            </div>
          )}
        </div>
      </div>
    </Container>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-soft ring-1 ring-slate-200">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-black ${color}`}>{value}</div>
    </div>
  );
}
