/** Consistent client-side export names: nexfern_<module>_YYYY-MM-DD.csv */
export function nexfernCsvFilename(module: string): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const safe = module.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "export";
  return `nexfern_${safe}_${y}-${m}-${day}.csv`;
}
