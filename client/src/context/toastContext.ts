import * as React from "react";
import type { ToastContextValue } from "./toastTypes";

export const ToastContext = React.createContext<ToastContextValue | null>(null);
