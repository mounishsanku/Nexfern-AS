import * as React from "react";
import { ToastContext } from "./toastContext";
import type { ToastContextValue, ToastItem, ToastType } from "./toastTypes";

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const remove = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = React.useCallback(
    (message: string, type: ToastType = "info") => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setItems((prev) => [...prev, { id, message, type }]);
      window.setTimeout(() => remove(id), 4500);
    },
    [remove],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast: push,
      success: (m) => push(m, "success"),
      error: (m) => push(m, "error"),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2 sm:bottom-6 sm:right-6"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={[
              "pointer-events-auto rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ring-1 ring-inset transition-opacity",
              t.type === "success" && "bg-emerald-50 text-emerald-900 ring-emerald-200",
              t.type === "error" && "bg-red-50 text-red-800 ring-red-200",
              t.type === "info" && "bg-slate-900 text-white ring-slate-700",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
