import * as React from "react";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { Table } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useLocalization } from "@/context/LocalizationContext";
import {
  uploadImport,
  getImportPreview,
  executeImport,
  getImportJobs,
  fetchEntities,
  downloadImportTemplate,
} from "@/adminApi";
import { useToast } from "@/context/useToast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Entity {
  _id: string;
  name: string;
  country: string;
}

interface ImportError {
  row: number;
  field: string;
  message: string;
}

interface ImportSummary {
  totalRows: number;
  validRows: number;
  errorRows: number;
  importedRows: number;
}

interface ImportJob {
  _id: string;
  createdAt: string;
  fileName: string;
  type: string;
  status: string;
  entityId?: { name: string; country: string };
  uploadedBy?: { name: string; email: string };
  summary: ImportSummary;
  errors: ImportError[];
  previewData?: Record<string, unknown>[];
}

const IMPORT_TYPES = [
  { value: "invoice",  label: "Invoices",  icon: "📄", needsFY: true },
  { value: "expense",  label: "Expenses",  icon: "💸", needsFY: true },
  { value: "payment",  label: "Payments",  icon: "💰", needsFY: true },
  { value: "customer", label: "Customers", icon: "👤", needsFY: false },
  { value: "vendor",   label: "Vendors",   icon: "🏭", needsFY: false },
] as const;

type ImportTypeValue = typeof IMPORT_TYPES[number]["value"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":  return <Badge variant="success">Completed</Badge>;
    case "failed":     return <Badge variant="danger">Failed</Badge>;
    case "ready":      return <Badge variant="neutral">Ready</Badge>;
    case "importing":  return <Badge variant="neutral">Importing…</Badge>;
    case "validating": return <Badge variant="neutral">Validating…</Badge>;
    default:           return <Badge variant="neutral">{status}</Badge>;
  }
}

function SummaryCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="text-center">
      <div className="text-xs text-slate-500 uppercase font-bold tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ?? ""}`}>{value}</div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportCenter() {
  const { features } = useLocalization();
  const { success, error: toastError } = useToast();
  const useImportEngine = features?.USE_IMPORT_ENGINE === true;

  const [jobs, setJobs] = React.useState<ImportJob[]>([]);
  const [entities, setEntities] = React.useState<Entity[]>([]);
  const [isUploadModalOpen, setIsUploadModalOpen] = React.useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = React.useState(false);
  const [activeJob, setActiveJob] = React.useState<ImportJob | null>(null);

  // Upload form state
  const [file, setFile] = React.useState<File | null>(null);
  const [importType, setImportType] = React.useState<ImportTypeValue>("invoice");
  const [importSource, setImportSource] = React.useState<"excel" | "tally">("excel");
  const [entityId, setEntityId] = React.useState("");
  const [isDragging, setIsDragging] = React.useState(false);

  // Loading states
  const [isUploading, setIsUploading] = React.useState(false);
  const [isExecuting, setIsExecuting] = React.useState(false);
  const [isDownloading, setIsDownloading] = React.useState(false);

  // Filter
  const [typeFilter, setTypeFilter] = React.useState<string>("all");

  React.useEffect(() => {
    if (useImportEngine) {
      loadJobs();
      fetchEntities()
        .then((data: unknown) => setEntities(data as Entity[]))
        .catch(console.error);
    }
  }, [useImportEngine]);

  const loadJobs = async () => {
    try {
      const data = await getImportJobs();
      setJobs(data as ImportJob[]);
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  // ── Drag and drop handlers ─────────────────────────────────────────────────

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    const isXml = dropped && /\.(xml)$/i.test(dropped.name);
    const isExcel = dropped && /\.(xlsx|xls|csv)$/i.test(dropped.name);

    if (importSource === "tally" && !isXml) {
      toastError("Tally import requires an XML file");
      return;
    }
    if (importSource === "excel" && !isExcel) {
      toastError("Excel import requires .xlsx, .xls, or .csv");
      return;
    }

    if (dropped) setFile(dropped);
  };

  // ── Upload ─────────────────────────────────────────────────────────────────

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !entityId) return;
    setIsUploading(true);
    try {
      const job = await uploadImport(file, importType, entityId, importSource) as ImportJob;
      success(`Parsed ${job.summary.totalRows} rows — ${job.summary.validRows} valid, ${job.summary.errorRows} errors`);
      setIsUploadModalOpen(false);
      setFile(null);
      await openPreview(job._id);
      loadJobs();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  // ── Preview ────────────────────────────────────────────────────────────────

  const openPreview = async (jobId: string) => {
    try {
      const jobData = await getImportPreview(jobId) as ImportJob;
      setActiveJob(jobData);
      setIsPreviewModalOpen(true);
    } catch (err) {
      toastError((err as Error).message);
    }
  };

  // ── Execute ────────────────────────────────────────────────────────────────

  const handleExecute = async () => {
    if (!activeJob) return;
    setIsExecuting(true);
    try {
      const result = await executeImport(activeJob._id) as ImportJob;
      if (result.status === "completed") {
        success(`✅ Import completed — ${result.summary.importedRows} ${activeJob.type}s created`);
        setIsPreviewModalOpen(false);
        setActiveJob(null);
      } else {
        toastError(`Import failed: ${result.errors[result.errors.length - 1]?.message ?? "Unknown error"}`);
        setActiveJob(result);
      }
      loadJobs();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setIsExecuting(false);
    }
  };

  // ── Template download ──────────────────────────────────────────────────────

  const handleDownloadTemplate = async (type: string) => {
    setIsDownloading(true);
    try {
      await downloadImportTemplate(type);
      success(`${type} template downloaded`);
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setIsDownloading(false);
    }
  };

  // ── Disabled gate ──────────────────────────────────────────────────────────

  if (!useImportEngine) {
    return (
      <Container className="py-6">
        <Card className="p-12 text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-xl font-semibold mb-2">Import Engine Disabled</h2>
          <p className="text-slate-500">Enable the <code className="bg-slate-100 px-1 rounded">USE_IMPORT_ENGINE</code> feature flag to use this module.</p>
        </Card>
      </Container>
    );
  }

  const filteredJobs = typeFilter === "all" ? jobs : jobs.filter(j => j.type === typeFilter);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Container className="py-6">

      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Import Center</h1>
          <p className="text-sm text-slate-500 mt-1">Bulk import customers, vendors, invoices, and expenses from Excel</p>
        </div>
        <Button id="btn-new-import" variant="primary" onClick={() => setIsUploadModalOpen(true)}>
          + New Import
        </Button>
      </div>

      {/* Template downloads */}
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-slate-600">Download Templates:</span>
          {IMPORT_TYPES.map(t => (
            <button
              key={t.value}
              id={`btn-template-${t.value}`}
              onClick={() => handleDownloadTemplate(t.value)}
              disabled={isDownloading}
              className="text-xs px-3 py-1.5 rounded-full border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50"
            >
              {t.icon} {t.label} (.xlsx)
            </button>
          ))}
        </div>
      </Card>

      {/* Filter bar */}
      <div className="flex gap-2 mb-3">
        {["all", ...IMPORT_TYPES.map(t => t.value)].map(v => (
          <button
            key={v}
            onClick={() => setTypeFilter(v)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              typeFilter === v
                ? "bg-blue-600 text-white border-blue-600"
                : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {v === "all" ? "All Types" : v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {/* Jobs table */}
      <Card>
        <Table>
          <thead>
            <tr>
              <th>Date</th>
              <th>File</th>
              <th>Type</th>
              <th>Entity</th>
              <th>Status</th>
              <th className="text-right">Total</th>
              <th className="text-right">Valid</th>
              <th className="text-right">Errors</th>
              <th className="text-right">Imported</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-8 text-slate-400">
                  No import history{typeFilter !== "all" ? ` for ${typeFilter}s` : ""}
                </td>
              </tr>
            ) : (
              filteredJobs.map(job => (
                <tr key={job._id} className={job.status === "failed" ? "bg-red-50" : ""}>
                  <td className="text-xs text-slate-500">{new Date(job.createdAt).toLocaleString()}</td>
                  <td className="font-medium text-sm max-w-[180px] truncate" title={job.fileName}>{job.fileName}</td>
                  <td>
                    <span className="capitalize text-xs font-medium px-2 py-0.5 rounded bg-slate-100">
                      {IMPORT_TYPES.find(t => t.value === job.type)?.icon} {job.type}
                    </span>
                  </td>
                  <td className="text-sm">{job.entityId?.name ?? "—"}</td>
                  <td><StatusBadge status={job.status} /></td>
                  <td className="text-right">{job.summary.totalRows}</td>
                  <td className="text-right text-green-600 font-medium">{job.summary.validRows}</td>
                  <td className="text-right text-red-600 font-medium">{job.summary.errorRows || "—"}</td>
                  <td className="text-right font-semibold">{job.summary.importedRows}</td>
                  <td>
                    <Button
                      id={`btn-view-${job._id}`}
                      variant="secondary"
                      onClick={() => openPreview(job._id)}
                    >
                      View
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>

      {/* ── Upload Modal ─────────────────────────────────────────────────────── */}
      <Modal open={isUploadModalOpen} onClose={() => { setIsUploadModalOpen(false); setFile(null); }} title="Upload Import File">
        <form onSubmit={handleUpload} className="space-y-4">

          {/* Import Source selector */}
          <div>
            <label className="block text-sm font-medium mb-2">Import Source</label>
            <div className="flex gap-2 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => { setImportSource("excel"); setFile(null); }}
                className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${
                  importSource === "excel" ? "bg-white shadow-sm text-blue-600" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Excel / CSV
              </button>
              <button
                type="button"
                id="source-tally"
                onClick={() => { setImportSource("tally"); setFile(null); }}
                className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${
                  importSource === "tally" ? "bg-white shadow-sm text-blue-600" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Tally XML
              </button>
            </div>
          </div>

          {/* Import type selector */}
          <div>
            <label className="block text-sm font-medium mb-2">Import Type</label>
            <div className="grid grid-cols-2 gap-2">
              {IMPORT_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  id={`type-option-${t.value}`}
                  onClick={() => setImportType(t.value)}
                  className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${
                    importType === t.value
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <span className="text-xl">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Entity selector */}
          <div>
            <label className="block text-sm font-medium mb-1">Entity</label>
            <select
              id="import-entity-select"
              className="w-full rounded-md border border-gray-300 p-2 text-sm"
              required
              value={entityId}
              onChange={e => setEntityId(e.target.value)}
            >
              <option value="">Select Entity…</option>
              {entities.map(e => (
                <option key={e._id} value={e._id}>{e.name} ({e.country})</option>
              ))}
            </select>
          </div>

          {/* Drag-drop file zone */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {importSource === "tally" ? "Tally XML File" : "Spreadsheet File"}
              <span className="ml-1 text-xs text-slate-400">
                {importSource === "tally" ? "(.xml)" : "(.xlsx, .xls, .csv)"}
              </span>
            </label>
            <div
              id="import-drop-zone"
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                isDragging ? "border-blue-500 bg-blue-50" : "border-slate-300 hover:border-slate-400"
              }`}
            >
              {file ? (
                <div className="space-y-1">
                  <div className="text-green-600 font-medium text-sm">✅ {file.name}</div>
                  <div className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</div>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <div className="text-3xl mb-2">{importSource === "tally" ? "📜" : "📂"}</div>
                  <p className="text-sm text-slate-500">Drag &amp; drop your {importSource === "tally" ? "XML" : "file"} here, or</p>
                  <label className="cursor-pointer text-blue-600 text-sm font-medium hover:underline">
                    browse to upload
                    <input
                      id="import-file-input"
                      type="file"
                      accept={importSource === "tally" ? ".xml" : ".xlsx,.xls,.csv"}
                      className="sr-only"
                      onChange={e => setFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  <p className="text-xs text-slate-400 mt-1">Max 20 MB · 5,000 rows</p>
                </>
              )}
            </div>
          </div>

          {/* Help hint */}
          <p className="text-xs text-slate-500">
            {importSource === "excel" ? (
              <>
                Not sure about the format?{" "}
                <button
                  type="button"
                  onClick={() => handleDownloadTemplate(importType)}
                  className="text-blue-600 hover:underline"
                >
                  Download {importType} template
                </button>
              </>
            ) : (
              <>
                Export from Tally using <code className="bg-slate-100 px-1 rounded">Display &gt; List of Accounts &gt; Export (XML)</code>
              </>
            )}
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => { setIsUploadModalOpen(false); setFile(null); }}>
              Cancel
            </Button>
            <Button
              id="btn-upload-submit"
              variant="primary"
              type="submit"
              disabled={isUploading || !file || !entityId}
            >
              {isUploading ? "Uploading…" : "Upload & Validate"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Preview Modal ─────────────────────────────────────────────────────── */}
      <Modal
        open={isPreviewModalOpen}
        onClose={() => { setIsPreviewModalOpen(false); setActiveJob(null); }}
        title={`Import Preview — ${activeJob?.type ?? ""} (${activeJob?.fileName ?? ""})`}
      >
        {activeJob && (
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">

            {/* Summary strip */}
            <div className="grid grid-cols-4 gap-4 p-4 bg-slate-50 rounded-lg">
              <SummaryCard label="Total" value={activeJob.summary.totalRows} />
              <SummaryCard label="Valid" value={activeJob.summary.validRows} color="text-green-600" />
              <SummaryCard label="Errors" value={activeJob.summary.errorRows} color={activeJob.summary.errorRows > 0 ? "text-red-600" : "text-slate-400"} />
              <div className="text-center">
                <div className="text-xs text-slate-500 uppercase font-bold tracking-wide">Status</div>
                <div className="mt-1"><StatusBadge status={activeJob.status} /></div>
              </div>
            </div>

            {/* Validation errors */}
            {activeJob.errors?.length > 0 && (
              <div className="border border-red-200 bg-red-50 rounded-lg p-4">
                <h3 className="text-red-800 font-bold mb-2 text-sm">
                  ⚠️ Validation Errors ({activeJob.errors.length})
                </h3>
                <ul className="text-sm text-red-700 space-y-1">
                  {activeJob.errors.slice(0, 20).map((err, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="font-mono text-xs bg-red-100 px-1 rounded">Row {(err.row ?? 0) + 1}</span>
                      <span className="text-red-500 font-medium">[{err.field}]</span>
                      <span>{err.message}</span>
                    </li>
                  ))}
                  {activeJob.errors.length > 20 && (
                    <li className="text-red-400 text-xs">…and {activeJob.errors.length - 20} more errors</li>
                  )}
                </ul>
              </div>
            )}

            {/* Data preview table */}
            {activeJob.previewData && activeJob.previewData.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-slate-600 mb-2">
                  Data Preview (first {Math.min(10, activeJob.previewData.length)} of {activeJob.previewData.length} rows)
                </h3>
                <div className="border rounded-md overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-2 text-left text-gray-500 font-medium">#</th>
                        {Object.keys(activeJob.previewData[0]).map(k => (
                          <th key={k} className="px-2 py-2 text-left text-gray-500 font-medium uppercase">{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {activeJob.previewData.slice(0, 10).map((row, i) => {
                        // Highlight rows that have errors
                        const rowHasError = activeJob.errors.some(e => e.row === i);
                        return (
                          <tr key={i} className={rowHasError ? "bg-red-50" : ""}>
                            <td className="px-2 py-1.5 text-gray-400 font-mono">{i + 1}</td>
                            {Object.values(row).map((val, j) => (
                              <td key={j} className="px-2 py-1.5 whitespace-nowrap text-gray-700">
                                {val === null || val === undefined ? <span className="text-gray-300">—</span> : String(val)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                      {activeJob.previewData.length > 10 && (
                        <tr>
                          <td colSpan={100} className="px-2 py-2 text-center text-gray-400 text-xs">
                            …and {activeJob.previewData.length - 10} more rows
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Action footer */}
            <div className="flex justify-between items-center pt-2 border-t">
              <div className="text-xs text-slate-400">
                {activeJob.status === "ready"
                  ? `${activeJob.summary.validRows} rows ready to import atomically`
                  : activeJob.status === "completed"
                  ? `✅ ${activeJob.summary.importedRows} rows imported successfully`
                  : activeJob.status === "failed"
                  ? "❌ Fix validation errors before importing"
                  : null}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => { setIsPreviewModalOpen(false); setActiveJob(null); }}>
                  Close
                </Button>
                {activeJob.status === "ready" && (
                  <Button
                    id="btn-confirm-import"
                    variant="primary"
                    onClick={handleExecute}
                    disabled={isExecuting}
                  >
                    {isExecuting ? "Importing…" : `Confirm Import (${activeJob.summary.validRows} rows)`}
                  </Button>
                )}
              </div>
            </div>

          </div>
        )}
      </Modal>

    </Container>
  );
}
