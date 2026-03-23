import * as React from "react";

/** Focus first focusable control when `active` becomes true (e.g. modal or section opened). */
export function useFirstFieldFocus<T extends HTMLElement>(active: boolean) {
  const ref = React.useRef<T | null>(null);

  React.useEffect(() => {
    if (!active) return;
    const id = window.requestAnimationFrame(() => {
      ref.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [active]);

  return ref;
}

/** Submit form on Enter from inputs (not textarea). */
export function createFormEnterSubmitHandler(formId?: string) {
  return (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    if (target.tagName === "TEXTAREA") return;
    if (target.tagName === "BUTTON") return;
    if (target.closest("[data-skip-enter-submit]")) return;
    e.preventDefault();
    const form = formId ? document.getElementById(formId) : e.currentTarget;
    if (form instanceof HTMLFormElement) form.requestSubmit();
  };
}
