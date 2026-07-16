"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, CirclePlus, SlidersHorizontal } from "lucide-react";
import type { TradingLayout } from "@/lib/trading.types";

const LAYOUT_OPTIONS = [
  { id: "advanced", label: "Advanced" },
  { id: "analytics", label: "Analytics" },
] satisfies { id: TradingLayout; label: string }[];

export function TradingLayoutMenu({
  layout,
  onLayoutChange,
}: {
  layout: TradingLayout;
  onLayoutChange: (layout: TradingLayout) => void;
}) {
  const activeOption = LAYOUT_OPTIONS.find((option) => option.id === layout) ?? LAYOUT_OPTIONS[0];

  return (
    <Menu.Root>
      <Menu.Trigger
        className="flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg bg-input-bg px-2.5 font-semibold text-[11px] text-panel-text ring-1 ring-panel-border transition-colors hover:bg-input-hover hover:text-panel-text-active focus-visible:ring-2 focus-visible:ring-panel-text-active/50"
        id="trading-layout-menu-trigger"
      >
        <SlidersHorizontal className="size-3.5" />
        {activeOption.label}
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={8}>
          <Menu.Popup className="z-50 min-w-[230px] overflow-hidden rounded-2xl border border-panel-border bg-panel-bg-darker p-1.5 shadow-[0_20px_60px_var(--panel-shadow)] outline-none transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
            <Menu.Group>
              <Menu.GroupLabel className="px-3 pt-2 pb-1.5 text-[10px] text-panel-text-muted uppercase tracking-[0.18em]">
                Trading Layout
              </Menu.GroupLabel>

              <Menu.RadioGroup
                onValueChange={(value) => onLayoutChange(value as TradingLayout)}
                value={layout}
              >
                {LAYOUT_OPTIONS.map((option) => (
                  <Menu.RadioItem
                    className="grid cursor-pointer grid-cols-[16px_1fr] items-center gap-2 rounded-xl px-3 py-2 font-medium text-[13px] text-panel-text-muted outline-none transition-colors data-highlighted:bg-input-hover data-checked:text-panel-text-active"
                    closeOnClick
                    key={option.id}
                    value={option.id}
                  >
                    <Menu.RadioItemIndicator className="col-start-1">
                      <Check className="size-4" />
                    </Menu.RadioItemIndicator>
                    <span className="col-start-2">{option.label}</span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>

            <Menu.Separator className="mx-2 my-1.5 h-px bg-panel-border" />

            <Menu.Item
              className="flex cursor-not-allowed items-center gap-2 rounded-xl px-3 py-2 font-medium text-[13px] text-panel-text-muted opacity-60 outline-none data-highlighted:bg-input-hover"
              disabled
            >
              <CirclePlus className="size-4" />
              Add a new layout
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
