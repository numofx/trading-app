"use client";

import { cn } from "@/lib/cn";

/**
 * A ticket label: muted and small, with a help cursor when it carries a tooltip. The tooltip is the
 * browser's own (`title`), as every other hint in the terminal is, so the explanation sits a hover
 * away without costing the ticket a line.
 */
export function FieldLabel({
  children,
  className,
  htmlFor,
  tooltip,
}: {
  children: string;
  className?: string;
  htmlFor?: string;
  tooltip?: string;
}) {
  const Tag = htmlFor === undefined ? "span" : "label";
  return (
    <Tag
      className={cn("text-[11px] text-panel-text-muted", tooltip && "cursor-help", className)}
      htmlFor={htmlFor}
      title={tooltip}
    >
      {children}
    </Tag>
  );
}
