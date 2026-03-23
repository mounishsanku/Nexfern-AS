import type { FormEvent } from "react";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { apiFetch } from "@/api";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { getStoredRole } from "@/components/RoleProtectedRoute";

export function Login() {
  const token =
    typeof window !== "undefined" ? window.localStorage.getItem("token") : null;

  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const data = await apiFetch<{
        token?: string;
        message?: string;
        user?: { role?: string; permissions?: string[] };
      }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      if (!data?.token) {
        console.error("Login response missing token:", data);
        throw new Error("Login succeeded but no token was returned.");
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("role", data.user?.role ?? "receptionist");
      localStorage.setItem("permissions", JSON.stringify(data.user?.permissions ?? []));

      const role = getStoredRole();
      if (role === "admin" || role === "accountant") navigate("/dashboard");
      else if (role === "auditor") navigate("/reports");
      else navigate("/invoices");
    } catch (err) {
      console.error("Login failed:", err);
      const message =
        err instanceof Error ? err.message : "Unable to login. Try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  if (token) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Container className="py-10">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="text-sm font-semibold text-slate-600">Login</div>

        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">
          Welcome back
        </h1>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          Sign in to access your dashboard.
        </p>

        <form className="mt-6 grid gap-3" onSubmit={onSubmit}>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </label>

          <Button
            type="submit"
            variant="primary"
            className="w-full justify-center"
            disabled={loading}
          >
            {loading ? "Signing in..." : "Login"}
          </Button>

          {error && (
            <p className="text-sm font-semibold text-red-600">{error}</p>
          )}

          <p className="mt-3 text-center text-sm font-semibold text-slate-600">
            Don't have an account?{" "}
            <Link to="/signup" className="text-primary hover:underline">
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </Container>
  );
}
