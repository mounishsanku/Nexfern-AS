import Link from "next/link";
import * as React from "react";

type CommonProps = {
  children: React.ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
};

type ButtonAsButton = CommonProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: never;
  };

type ButtonAsLink = CommonProps & {
  href: string;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">;

export type ButtonProps = ButtonAsButton | ButtonAsLink;

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-primary text-white shadow-soft hover:bg-primary-600 active:bg-primary-700",
  secondary:
    "bg-white text-slate-900 shadow-soft hover:bg-slate-50 active:bg-slate-100 ring-1 ring-inset ring-slate-200",
  ghost: "bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200",
};

const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-9 px-3",
  md: "h-10 px-4",
};

export function Button(props: ButtonAsLink): React.ReactElement;
export function Button(props: ButtonAsButton): React.ReactElement;
export function Button(props: ButtonProps) {
  if ("href" in props && typeof props.href === "string") {
    const p = props as ButtonAsLink;
    const {
      href,
      className,
      children,
      variant = "secondary",
      size = "md",
      ...linkProps
    } = p;

    const classes = cx(base, variants[variant], sizes[size], className);
    return (
      <Link href={href} className={classes} {...linkProps}>
        {children}
      </Link>
    );
  }

  const { className, children, variant = "secondary", size = "md", ...buttonProps } =
    props;
  const classes = cx(base, variants[variant], sizes[size], className);

  return (
    <button className={classes} {...buttonProps}>
      {children}
    </button>
  );
}

