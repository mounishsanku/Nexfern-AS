/**
 * Smoke-test public API health (no auth). Phase 5 — extend with token for protected routes.
 * Usage: node scripts/apiHealthSmoke.js [baseUrl]
 * Default base: http://127.0.0.1:5000
 */

const base = process.argv[2] || process.env.API_BASE || "http://127.0.0.1:5000";

async function get(path) {
  const url = `${base.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { path, status: res.status, ok: res.ok, body };
}

async function main() {
  const results = [];
  for (const p of ["/health", "/api/health"]) {
    try {
      results.push(await get(p));
    } catch (e) {
      results.push({ path: p, error: String(e.message || e) });
    }
  }
  const out = {
    base,
    results,
    allOk: results.every((r) => r.ok || r.status === 200),
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 2));
  if (!out.allOk) process.exit(1);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
