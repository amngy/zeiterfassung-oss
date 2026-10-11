import * as React from "react";
import { cn } from "@/lib/cn";
import { InfoHint } from "@/components/ui/info-hint";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-sm font-medium text-ink", className)}
      {...props}
    />
  );
}

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  /** Optional "?" help bubble shown next to the label. */
  info?: React.ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Labelled form field with optional hint, help bubble and validation error. */
export function Field({
  label,
  htmlFor,
  hint,
  info,
  error,
  required,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="inline-flex items-center gap-1">
          <Label htmlFor={htmlFor}>
            {label}
            {required && <span className="ml-0.5 text-danger">*</span>}
          </Label>
          {info && <InfoHint>{info}</InfoHint>}
        </span>
        {hint && !error && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}
