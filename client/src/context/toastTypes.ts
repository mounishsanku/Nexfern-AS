export type ToastType = "success" | "error" | "info";

export type ToastItem = { id: string; message: string; type: ToastType };

export type ToastContextValue = {
  toast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
};
