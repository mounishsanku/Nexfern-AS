import type { FormEvent } from "react";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { apiFetch } from "@/api";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

export function Signup() {
  const token =
    typeof window !== "undefined" ? window.localStorage.getItem("token") : null;

  const navigate = useNavigate();
  const [name, setName] = useState("");
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
      await apiFetch<{ message?: string }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });

      navigate("/login", { replace: true });
    } catch (err) {
      console.error("Signup failed:", err);
      const message =
        err instanceof Error ? err.message : "Unable to sign up. Try again.";
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
        <div className="text-sm font-semibold text-slate-600">Signup</div>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">
          Create your account
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Start managing invoices, expenses, and reports.
        </p>

        <form className="mt-6 grid gap-3" onSubmit={onSubmit}>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
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
              autoComplete="new-password"
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
            {loading ? "Creating..." : "Sign up"}
          </Button>

          {error ? (
            <p className="text-sm font-semibold leading-5 text-red-600">
              {error}
            </p>
          ) : null}

          <p className="mt-3 text-center text-sm font-semibold text-slate-600">
            Already have an account?{" "}
            <Link to="/login" className="text-primary hover:underline">
              Login
            </Link>
          </p>
        </form>
      </div>
    </Container>
  );
}
