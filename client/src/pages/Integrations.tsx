import { useState, useEffect, useCallback } from "react";
import { useLocalization } from "@/context/LocalizationContext";
import { useToast } from "@/context/useToast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { InlineSpinner } from "@/components/ui/Spinner";
import { getApiBase } from "@/api";

interface Integration {
  _id: string;
  provider: "razorpay" | "stripe" | "bank-feed" | "zoho" | "salesforce";
  type: string;
  status: "active" | "inactive" | "error" | "pending";
  lastSyncAt?: string;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  updatedAt: string;
}

const PROVIDER_META: Record<string, { label: string; icon: string; description: string; type: string }> = {
  razorpay: { label: "Razorpay", icon: "💳", description: "Accept payments via Razorpay gateway", type: "payment_gateway" },
  stripe: { label: "Stripe", icon: "⚡", description: "Accept payments via Stripe gateway", type: "payment_gateway" },
  "bank-feed": { label: "Bank Feed", icon: "🏦", description: "Import bank transactions for reconciliation", type: "bank_feed" },
  zoho: { label: "Zoho CRM", icon: "📋", description: "Sync customers and invoices with Zoho", type: "crm" },
  salesforce: { label: "Salesforce", icon: "☁️", description: "Sync customers and invoices with Salesforce", type: "erp" },
};

async function api(path: string, options?: RequestInit) {
  const base = getApiBase();
  const res = await fetch(`${base}${path}`, {
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

export function Integrations() {
  const { features } = useLocalization();
  const { success, error: toastError } = useToast();

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [showCredModal, setShowCredModal] = useState<string | null>(null);
  const [credForm, setCredForm] = useState({ apiKey: "", apiSecret: "", webhookSecret: "" });
  const [activeTab, setActiveTab] = useState<"providers" | "webhooks">("providers");
  const [webhookEvents, setWebhookEvents] = useState<unknown[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);

  const useIntegrations = features?.USE_INTEGRATIONS === true;

  const load = useCallback(async () => {
    try {
      const data = await api("/api/integrations");
      setIntegrations(data);
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWebhooks = useCallback(async () => {
    setWebhooksLoading(true);
    try {
      const data = await api("/api/integrations/webhook-events");
      setWebhookEvents(data);
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setWebhooksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (useIntegrations) load();
  }, [useIntegrations, load]);

  useEffect(() => {
    if (activeTab === "webhooks") loadWebhooks();
  }, [activeTab]);

  const handleToggle = async (integration: Integration) => {
    try {
      const newStatus = integration.status === "active" ? "inactive" : "active";
      await api(`/api/integrations/${integration._id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      success(`${PROVIDER_META[integration.provider]?.label} ${newStatus === "active" ? "enabled" : "disabled"}`);
      load();
    } catch (e: any) {
      toastError(e.message);
    }
  };

  const handleConnect = async (provider: string) => {
    if (!credForm.apiKey) { toastError("API key is required"); return; }
    setConnecting(provider);
    try {
      await api("/api/integrations", {
        method: "POST",
        body: JSON.stringify({
          provider,
          type: PROVIDER_META[provider]?.type,
          credentials: { apiKey: credForm.apiKey, apiSecret: credForm.apiSecret, webhookSecret: credForm.webhookSecret },
        }),
      });
      success(`${PROVIDER_META[provider]?.label} connected`);
      setShowCredModal(null);
      setCredForm({ apiKey: "", apiSecret: "", webhookSecret: "" });
      load();
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setConnecting(null);
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, "success" | "danger" | "warning" | "neutral"> = {
      active: "success", error: "danger", pending: "warning", inactive: "neutral",
    };
    return <Badge variant={map[status] ?? "neutral"}>{status}</Badge>;
  };

  if (!useIntegrations) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center min-h-[400px]">
        <div className="w-16 h-16 mb-4 text-gray-300">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">Integrations Disabled</h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-md">
          Enable <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">USE_INTEGRATIONS</code> in company settings to connect payment gateways, bank feeds, and CRM systems.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">External Integrations</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Connect payment gateways, bank feeds, and CRM systems securely.</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {(["providers", "webhooks"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              activeTab === tab
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {tab === "providers" ? "Providers" : "Webhook Logs"}
          </button>
        ))}
      </div>

      {/* Providers Tab */}
      {activeTab === "providers" && (
        <div>
          {loading ? (
            <div className="flex justify-center p-12"><InlineSpinner /></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(PROVIDER_META).map(([providerKey, meta]) => {
                const existing = integrations.find((i) => i.provider === providerKey);
                return (
                  <div key={providerKey} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{meta.icon}</span>
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-white">{meta.label}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{meta.description}</p>
                        </div>
                      </div>
                      {existing ? statusBadge(existing.status) : <Badge variant="neutral">Not Connected</Badge>}
                    </div>

                    {existing && (
                      <p className="text-xs text-gray-400">
                        Last sync: {existing.lastSyncAt ? new Date(existing.lastSyncAt).toLocaleString() : "Never"}
                      </p>
                    )}

                    <div className="flex gap-2 mt-auto">
                      {existing ? (
                        <>
                          <Button
                            variant={existing.status === "active" ? "secondary" : "primary"}
                            size="sm"
                            onClick={() => handleToggle(existing)}
                          >
                            {existing.status === "active" ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setShowCredModal(providerKey); setCredForm({ apiKey: "", apiSecret: "", webhookSecret: "" }); }}
                          >
                            Rotate Keys
                          </Button>
                        </>
                      ) : (
                        <Button variant="primary" size="sm" onClick={() => setShowCredModal(providerKey)}>
                          Connect
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Webhook Logs Tab */}
      {activeTab === "webhooks" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {webhooksLoading ? (
            <div className="flex justify-center p-12"><InlineSpinner /></div>
          ) : webhookEvents.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">No webhook events recorded yet.</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  {["Provider", "Event Type", "Status", "Replay?", "Sig Valid?", "Received"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {(webhookEvents as any[]).map((evt: any) => (
                  <tr key={evt._id}>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white capitalize">{evt.provider}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{evt.eventType}</td>
                    <td className="px-4 py-3">{statusBadge(evt.status)}</td>
                    <td className="px-4 py-3">{evt.replayDetected ? <Badge variant="danger">Yes</Badge> : <Badge variant="success">No</Badge>}</td>
                    <td className="px-4 py-3">{evt.signatureValid ? <Badge variant="success">Valid</Badge> : <Badge variant="danger">Invalid</Badge>}</td>
                    <td className="px-4 py-3 text-gray-500">{new Date(evt.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Credentials Modal */}
      {showCredModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
              Connect {PROVIDER_META[showCredModal]?.label}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Credentials are encrypted with AES-256 before storage and never returned after saving.
            </p>
            <div className="space-y-3">
              {["apiKey", "apiSecret", "webhookSecret"].map((field) => (
                <div key={field}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 capitalize">
                    {field.replace(/([A-Z])/g, " $1")}
                  </label>
                  <input
                    type="password"
                    value={(credForm as any)[field]}
                    onChange={(e) => setCredForm((p) => ({ ...p, [field]: e.target.value }))}
                    placeholder={`Enter ${field}`}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <Button variant="ghost" onClick={() => setShowCredModal(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => handleConnect(showCredModal)}
                disabled={connecting === showCredModal}
              >
                {connecting === showCredModal ? <InlineSpinner /> : "Save & Encrypt"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
