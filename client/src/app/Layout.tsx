import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { API } from "@/api";

export function Layout() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/health`)
      .then(async (r) => {
        if (!r.ok) return false;
        const data = (await r.json()) as { status?: string };
        return data.status === "ok";
      })
      .catch(() => false)
      .then((ok) => {
        if (!cancelled) setBackendOk(ok);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {backendOk === false && (
        <div
          role="alert"
          className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-900"
        >
          Backend not running
        </div>
      )}
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

