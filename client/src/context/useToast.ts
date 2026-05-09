import * as React from "react";
import { ToastContext } from "./toastContext";
import type { ToastContextValue } from "./toastTypes";

const noopToastContext: ToastContextValue = {
  toast: () => {},
  success: () => {},
  error: () => {},
};

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    return noopToastContext;
  }
  return ctx;
}
