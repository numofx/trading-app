"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type PanelTab<T extends string> = { id: T; label: string };

/**
 * A panel's header tabs, shared by every panel so the terminal reads as one surface: a segmented
 * track with the selected tab raised out of it. `fill` splits the track evenly between the tabs;
 * otherwise it sits left at its own width, and `trailing` rides the right edge.
 *
 * `compact` is the ticket's in-body variant (Market/Limit): no track, the selected tab outlined.
 * The side selector directly above is already a filled two-up, and a second filled track there
 * made the order type read as another buy/sell choice.
 */
export function PanelTabs<T extends string>({
  className,
  compact = false,
  fill = false,
  onSelect,
  selected,
  tabs,
  trailing,
}: {
  className?: string;
  /** The ticket's outlined variant, shorter and without the track. */
  compact?: boolean;
  fill?: boolean;
  onSelect: (tab: T) => void;
  selected: T;
  tabs: readonly PanelTab<T>[];
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-3",
        compact ? "py-1" : "py-2.5",
        className
      )}
    >
      <div
        className={cn(
          // Tabs give way last: a trailing control squeezed first keeps every tab on screen.
          fill ? "grid min-w-0 flex-1" : "flex min-w-0 shrink-[0.1] overflow-x-auto",
          compact ? "gap-1" : "gap-0.5 bg-segment-bg p-0.5 ring-2 ring-panel-border"
        )}
        style={fill ? { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` } : undefined}
      >
        {tabs.map((tab) => {
          const active = selected === tab.id;
          return (
            <button
              aria-pressed={active}
              className={cn(
                "shrink-0 cursor-pointer whitespace-nowrap font-medium text-[13px] transition-colors",
                compact ? "h-7 px-3" : "h-8 px-3.5",
                active
                  ? "bg-segment-active-bg text-panel-text-active shadow-[0_1px_2px_var(--panel-shadow)] ring-2 ring-panel-ring"
                  : "text-panel-text-muted hover:text-panel-text-active"
              )}
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {trailing}
    </div>
  );
}

/** A panel with nothing to switch between gets a title in the tabs' place and type. */
export function PanelTitle({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "shrink-0 px-3 pt-3 pb-1 font-semibold text-[13px] text-panel-text-active",
        className
      )}
    >
      {children}
    </div>
  );
}
