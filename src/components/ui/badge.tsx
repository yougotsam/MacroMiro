import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "neutral",
  children,
}: {
  className?: string;
  tone?: "neutral" | "armed" | "down" | "paper";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center h-6 px-2 text-xs font-medium tracking-wide uppercase rounded-md border",
        tone === "neutral" && "border-border text-muted bg-surface",
        tone === "armed" && "border-armed/40 text-armed bg-armed/10",
        tone === "down" && "border-down/40 text-down bg-down/10",
        tone === "paper" && "border-border text-fg bg-surface-2",
        className,
      )}
    >
      {children}
    </span>
  );
}
