import { Navigate, Outlet } from "react-router-dom";

export function ProtectedRoute() {
  const token =
    typeof window !== "undefined" ? window.localStorage.getItem("token") : null;

  if (!token) return <Navigate to="/login" replace />;

  return <Outlet />;
}

