import * as React from "react";
import { inputClassName as baseInputClassName } from "@/constants/inputStyles";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`${baseInputClassName} ${className}`} {...rest} />;
}

export function FieldError({
  children,
  message,
}: {
  children?: React.ReactNode;
  /** Alias for children — use one or the other */
  message?: React.ReactNode;
}) {
  const content = message ?? children;
  if (!content) return null;
  return <p className="mt-1 text-xs font-semibold text-red-600">{content}</p>;
}
