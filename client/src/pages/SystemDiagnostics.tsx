import * as React from "react";
import { apiFetch, getStoredToken, downloadJsonBackup } from "@/api";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/context/ToastContext";

type Issue = {
  module: string;
  type: string;
  severity: "critical" | "warning" | "medium" | "low" | string;
  description: string;
  fixApplied: boolean;
};

type DiagnosticsResponse = {
  generatedAt: string;
  applySafeFixes: boolean;
  summary: {
    totalIssues: number;
    critical: number;
    warning?: number;
    medium: number;
    low: number;
    fixesAppliedCount: number;
    safeNormalizationWrites: number;
  };
  metrics: Record<string, number | boolean | string>;
  issues: Issue[];
};

type ValidateError = { code: string; message: string };
type ValidateResponse = {
  generatedAt: string;
  errors: ValidateError[];
  warnings: ValidateError[];
  metrics: Record<string, unknown>;
};

function severityClass(s: string) {
  if (s === "critical") return "text-red-700 bg-red-50 ring-red-200";
  if (s === "warning") return "text-amber-900 bg-amber-50 ring-amber-200";
  if (s === "medium") return "text-amber-800 bg-amber-50 ring-amber-200";
  return "text-slate-700 bg-slate-50 ring-slate-200";
}

export function SystemDiagnostics() {
  const { success } = useToast();
  const token = getStoredToken();
  const role = typeof window !== "undefined" ? window.localStorage.getItem("role") : null;
  const isAdmin = role === "admin";

  const [data, setData] = React.useState<DiagnosticsResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [backupBusy, setBackupBusy] = React.useState(false);

  const [validateData, setValidateData] = React.useState<ValidateResponse | null>(null);
  const [validateLoading, setValidateLoading] = React.useState(false);
  const [validateError, setValidateError] = React.useState<string | null>(null);

  const [restoreMode, setRestoreMode] = React.useState<"clear" | "merge">("merge");
  const [restoreConfirm, setRestoreConfirm] = React.useState(false);
  const [allowNonTransactional, setAllowNonTransactional] = React.useState(false);
  const [restoreBusy, setRestoreBusy] = React.useState(false);
  const [restoreMessage, setRestoreMessage] = React.useState<string | null>(null);
  const [restoreError, setRestoreError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  async function load(opts: { fix?: boolean } = {}) {
    if (!token) {
      setError("Not logged in");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = opts.fix ? "?fix=1" : "";
      const res = await apiFetch<DiagnosticsResponse>(`/system/diagnostics${q}`, { token });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load diagnostics");
    } finally {
      setLoading(false);
    }
  }

  async function runValidate() {
    if (!token) return;
    setValidateLoading(true);
    setValidateError(null);
    setRestoreMessage(null);
    try {
      const res = await apiFetch<ValidateResponse>("/system/validate", { token });
      setValidateData(res);
    } catch (e) {
      setValidateError(e instanceof Error ? e.message : "Validation request failed");
      setValidateData(null);
    } finally {
      setValidateLoading(false);
    }
  }

  async function runRestore(fileText: string) {
    if (!token || !isAdmin) return;
    let backup: unknown;
    try {
      backup = JSON.parse(fileText) as unknown;
    } catch {
      setRestoreError("File is not valid JSON.");
      return;
    }
    if (!backup || typeof backup !== "object") {
      setRestoreError("Backup must be a JSON object.");
      return;
    }
    if (!restoreConfirm) {
      setRestoreError('Check "I confirm restore" before running.');
      return;
    }

    setRestoreBusy(true);
    setRestoreError(null);
    setRestoreMessage(null);
    try {
      const qs = allowNonTransactional ? "?allowNonTransactional=1" : "";
      const res = await apiFetch<{ ok?: boolean; transactional?: boolean; stats?: unknown; message?: string; code?: string }>(
        `/system/restore${qs}`,
        {
          method: "POST",
          token,
          body: JSON.stringify({
            confirm: true,
            mode: restoreMode,
            backup,
            allowNonTransactional,
          }),
        },
      );
      const tx = res.transactional ? "transaction" : "non-transactional";
      setRestoreMessage(`Restore completed (${tx}). ${JSON.stringify(res.stats ?? {})}`);
      void runValidate();
      void load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Restore failed";
      const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code ?? "") : "";
      let hint = code ? `${msg} (${code})` : msg;
      if (code === "TRANSACTION_UNSUPPORTED") {
        hint += " Enable “Allow non-transactional” or use a MongoDB replica set, then try again.";
      }
      setRestoreError(hint);
    } finally {
      setRestoreBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function onRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      void runRestore(text);
    };
    reader.readAsText(f, "UTF-8");
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copyAllDiagnostics() {
    const payload = {
      exportedAt: new Date().toISOString(),
      diagnostics: data,
      validate: validateData,
    };
    void navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(
      () => success("Diagnostics copied to clipboard."),
      () => {},
    );
  }

  return (
    <Container className="py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-500">Operations</div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
            System diagnostics
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Integrity scans, backups, restore, and accounting validation. Restore is admin-only and can erase data
            when using &quot;clear&quot; mode.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            type="button"
            onClick={copyAllDiagnostics}
            disabled={!data && !validateData}
          >
            Copy diagnostics
          </Button>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? "Scanning…" : "Re-run scan"}
          </Button>
          <Button variant="primary" onClick={() => void load({ fix: true })} disabled={loading}>
            Scan + safe trim
          </Button>
          <Button
            variant="secondary"
            onClick={() => void runValidate()}
            disabled={validateLoading}
          >
            {validateLoading ? "Checking…" : "Run system check"}
          </Button>
          {isAdmin ? (
            <Button
              variant="secondary"
              onClick={() => {
                setBackupBusy(true);
                downloadJsonBackup("/system/backup", "nexfern-backup.json")
                  .catch(() => {})
                  .finally(() => setBackupBusy(false));
              }}
              disabled={backupBusy || !token}
            >
              {backupBusy ? "Preparing…" : "Backup data"}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mt-6 rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700 ring-1 ring-inset ring-red-200">
          {error}
        </div>
      ) : null}

      {/* ── System validation (GET /system/validate) ─────────────────────────── */}
      <div className="mt-8 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold text-slate-900">System check</h2>
          {!validateData && !validateError ? (
            <p className="text-sm text-slate-500">Run &quot;Run system check&quot; above to validate trial balance, balance sheet, and data integrity.</p>
          ) : null}
        </div>
          {validateError ? (
            <div className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700 ring-1 ring-inset ring-red-200">
              {validateError}
            </div>
          ) : null}
          {validateData ? (
            <>
              <div className="rounded-2xl bg-slate-50 p-4 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
                <div className="font-semibold text-slate-700">Metrics</div>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono">
                  {JSON.stringify(validateData.metrics, null, 2)}
                </pre>
                <div className="mt-2 text-slate-500">Generated: {validateData.generatedAt}</div>
              </div>

              <div className="overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-red-200">
                <div className="border-b border-red-100 bg-red-50/80 px-6 py-3 text-sm font-extrabold text-red-800">
                  Errors ({validateData.errors.length})
                </div>
                <div className="divide-y divide-slate-100">
                  {validateData.errors.length === 0 ? (
                    <div className="px-6 py-6 text-sm font-semibold text-emerald-700">No errors.</div>
                  ) : (
                    validateData.errors.map((err, idx) => (
                      <div key={`${err.code}-${idx}`} className="px-6 py-4">
                        <span className="text-xs font-bold uppercase text-red-600">{err.code}</span>
                        <p className="mt-1 text-sm text-slate-800">{err.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-amber-200">
                <div className="border-b border-amber-100 bg-amber-50/80 px-6 py-3 text-sm font-extrabold text-amber-900">
                  Warnings ({validateData.warnings.length})
                </div>
                <div className="divide-y divide-slate-100">
                  {validateData.warnings.length === 0 ? (
                    <div className="px-6 py-6 text-sm text-slate-500">No warnings.</div>
                  ) : (
                    validateData.warnings.map((w, idx) => (
                      <div key={`${w.code}-${idx}`} className="px-6 py-4">
                        <span className="text-xs font-bold uppercase text-amber-800">{w.code}</span>
                        <p className="mt-1 text-sm text-slate-800">{w.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : null}
      </div>

      {/* ── Restore (admin) ─────────────────────────────────────────────────── */}
      {isAdmin ? (
        <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
          <h2 className="text-lg font-extrabold text-slate-900">Restore data</h2>
          <p className="mt-2 text-sm text-slate-600">
            Upload a JSON backup from &quot;Backup data&quot;.{" "}
            <strong className="text-red-700">Clear</strong> removes finance collections (including financial years,
            customers, vendors) before import — requires backup <strong>version 2+</strong>.{" "}
            <strong>Merge</strong> inserts missing documents and skips duplicates.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <label className="text-sm font-semibold text-slate-700">
              Mode
              <select
                value={restoreMode}
                onChange={(e) => setRestoreMode(e.target.value as "clear" | "merge")}
                className="ml-2 h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"
              >
                <option value="merge">Merge (safe)</option>
                <option value="clear">Clear then import</option>
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={restoreConfirm}
                onChange={(e) => setRestoreConfirm(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary"
              />
              I confirm restore
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={allowNonTransactional}
                onChange={(e) => setAllowNonTransactional(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Allow non-transactional (dev / standalone MongoDB)
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="text-sm text-slate-600"
              disabled={restoreBusy}
              onChange={onRestoreFile}
            />
            {restoreBusy ? (
              <span className="text-sm font-semibold text-slate-500">Restoring…</span>
            ) : null}
          </div>
          {restoreError ? (
            <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-inset ring-red-200">
              {restoreError}
            </div>
          ) : null}
          {restoreMessage ? (
            <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
              {restoreMessage}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Finance diagnostics (existing service) ─────────────────────────── */}
      {data ? (
        <>
          <h2 className="mt-10 text-lg font-extrabold text-slate-900">Workflow diagnostics</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Card padding="sm" className="!p-4">
              <div className="text-xs font-semibold uppercase text-slate-500">Total issues</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums">{data.summary.totalIssues}</div>
            </Card>
            <Card padding="sm" className="!border-red-100 !bg-red-50/50 !p-4">
              <div className="text-xs font-semibold uppercase text-red-600">Critical</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-red-700">{data.summary.critical}</div>
            </Card>
            <Card padding="sm" className="!border-amber-100 !bg-amber-50/50 !p-4">
              <div className="text-xs font-semibold uppercase text-amber-900">Warning</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-amber-900">
                {data.summary.warning ?? 0}
              </div>
            </Card>
            <Card padding="sm" className="!border-amber-100 !bg-amber-50/50 !p-4">
              <div className="text-xs font-semibold uppercase text-amber-800">Medium</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-amber-900">{data.summary.medium}</div>
            </Card>
            <Card padding="sm" className="!p-4">
              <div className="text-xs font-semibold uppercase text-slate-500">Safe writes (last run)</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums">{data.summary.safeNormalizationWrites}</div>
            </Card>
          </div>

          <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
            <div className="font-semibold text-slate-700">Metrics</div>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono">
              {JSON.stringify(data.metrics, null, 2)}
            </pre>
            <div className="mt-2 text-slate-500">Generated: {data.generatedAt}</div>
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
            <div className="border-b border-slate-100 px-6 py-4 text-sm font-semibold text-slate-700">
              Issues ({data.issues.length})
            </div>
            <div className="divide-y divide-slate-100">
              {data.issues.length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-emerald-700">
                  No integrity issues detected for the current checks.
                </div>
              ) : (
                data.issues.map((issue, idx) => (
                  <div key={`${issue.type}-${idx}`} className="px-6 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold uppercase ring-1 ${severityClass(issue.severity)}`}
                      >
                        {issue.severity}
                      </span>
                      <span className="text-xs font-semibold text-slate-500">{issue.module}</span>
                      <span className="text-xs text-slate-400">{issue.type}</span>
                      {issue.fixApplied ? (
                        <span className="text-xs font-semibold text-emerald-600">fix applied</span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-slate-800">{issue.description}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      ) : (
        !error && (
          <div className="mt-6 rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-soft ring-1 ring-inset ring-slate-200">
            {loading ? "Loading diagnostics…" : "No data."}
          </div>
        )
      )}
    </Container>
  );
}
