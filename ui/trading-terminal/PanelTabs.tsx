"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** The terminal's one tab style: underlined text, 13px, the active tab in the brightest tone. */
const TAB_CLASSES =
  "-mb-px shrink-0 cursor-pointer whitespace-nowrap border-b-2 py-2.5 font-medium text-[13px] transition-colors";

export type PanelTab<T extends string> = { id: T; label: string };

/**
 * A panel's header tabs, shared by every panel so the terminal reads as one surface: underlined
 * text on a single rule, never a filled pill. `fill` splits the row evenly between the tabs (the
 * order book's two); otherwise they sit left with the gap, and `trailing` rides the right edge.
 */
export function PanelTabs<T extends string>({
  className,
  fill = false,
  onSelect,
  selected,
  tabs,
  trailing,
}: {
  className?: string;
  fill?: boolean;
  onSelect: (tab: T) => void;
  selected: T;
  tabs: readonly PanelTab<T>[];
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-3 border-panel-border border-b",
        className
      )}
    >
      <div
        className={fill ? "grid min-w-0 flex-1" : "flex min-w-0 gap-5 overflow-x-auto"}
        style={fill ? { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` } : undefined}
      >
        {tabs.map((tab) => (
          <button
            className={cn(
              TAB_CLASSES,
              selected === tab.id
                ? "border-panel-text-active text-panel-text-active"
                : "border-transparent text-panel-text-muted hover:text-panel-text"
            )}
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {trailing}
    </div>
  );
}

/** A panel with nothing to switch between gets the same header line, as a title rather than a tab. */
export function PanelTitle({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "shrink-0 border-panel-border border-b px-3 py-2.5 font-medium text-[13px] text-panel-text-active",
        className
      )}
    >
      {children}
    </div>
  );
}
