import { apiFetch, getStoredToken } from "./api";

const BASE = "/localization-admin";

export async function fetchEntities() {
  const token = getStoredToken();
  return apiFetch(`${BASE}/entities`, { token });
}

export async function createEntity(data: any) {
  const token = getStoredToken();
  return apiFetch(`${BASE}/entities`, {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function fetchCurrencies() {
  const token = getStoredToken();
  return apiFetch(`${BASE}/currencies`, { token });
}

export async function createCurrency(data: any) {
  const token = getStoredToken();
  return apiFetch(`${BASE}/currencies`, {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function fetchExchangeRates() {
  const token = getStoredToken();
  return apiFetch(`${BASE}/exchange-rates`, { token });
}

export async function createExchangeRate(data: any) {
  const token = getStoredToken();
  return apiFetch(`${BASE}/exchange-rates`, {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function fetchTaxProfiles() {
  const token = getStoredToken();
  return apiFetch(`${BASE}/tax-profiles`, { token });
}

export async function createTaxProfile(data: any) {
  const token = getStoredToken();
  return apiFetch(`${BASE}/tax-profiles`, {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function createTaxRule(data: any) {
  const token = getStoredToken();
  return apiFetch(`${BASE}/tax-rules`, {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function fetchLocalizationContext() {
  const token = getStoredToken();
  return apiFetch(`${BASE}/localization-context`, { token });
}

export async function uploadImport(file: File, type: string, entityId: string, source: string = "excel") {
  const token = getStoredToken();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("type", type);
  formData.append("entityId", entityId);
  formData.append("source", source);

  const res = await fetch("/api/import/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Failed to upload import");
  }
  return res.json();
}

export async function getImportPreview(jobId: string) {
  const token = getStoredToken();
  return apiFetch(`/import/preview/${jobId}`, { token });
}

export async function executeImport(jobId: string) {
  const token = getStoredToken();
  return apiFetch(`/import/execute/${jobId}`, {
    method: "POST",
    token,
  });
}

export async function getImportJobs() {
  const token = getStoredToken();
  return apiFetch(`/import/jobs`, { token });
}

export async function downloadImportTemplate(type: string): Promise<void> {
  const token = getStoredToken();
  const res = await fetch(`/api/import/template/${type}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Template download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nexfern_${type}_template.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
