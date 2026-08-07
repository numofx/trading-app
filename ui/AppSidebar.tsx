"use client";

import type { LucideIcon } from "lucide-react";
import { ChartColumn, ChevronsLeft, ChevronsRight, Diamond } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AppSection } from "@/ui/app-sidebar.types";

type SidebarNavItem = {
  icon: LucideIcon;
  id: AppSection;
  label: string;
};

const PRIMARY_NAV_ITEMS = [
  { icon: ChartColumn, id: "spot", label: "Spot" },
  { icon: Diamond, id: "derivatives", label: "Futures" },
] satisfies SidebarNavItem[];

export function AppSidebar({
  activeSection,
  collapsed,
  onCollapsedToggle,
  onSectionChange,
}: {
  activeSection: AppSection;
  collapsed: boolean;
  onCollapsedToggle: () => void;
  onSectionChange: (section: AppSection) => void;
}) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        // Hidden below `xl`: a fixed rail costs a quarter of a 375px screen. Phones get
        // `AppSectionSwitcher` instead, so exactly one of the two is ever displayed.
        "sticky top-0 hidden h-dvh shrink-0 flex-col justify-between self-start border-panel-border border-r bg-panel-bg px-2 py-3 transition-all duration-300 xl:flex",
        collapsed ? "w-16" : "w-24"
      )}
    >
      <div className="flex flex-col gap-1">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <SidebarNavButton
            active={activeSection === item.id}
            collapsed={collapsed}
            item={item}
            key={item.id}
            onSelect={onSectionChange}
          />
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex w-full cursor-pointer items-center justify-center rounded-xl py-2 text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text-active"
          onClick={onCollapsedToggle}
          type="button"
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
      </div>
    </nav>
  );
}

/**
 * Phone and tablet stand-in for the sidebar rail, which is hidden below `xl`. Shares
 * `PRIMARY_NAV_ITEMS` with the rail so the two never drift apart, and is itself hidden at
 * `xl` so only one primary nav is in the accessibility tree at a time.
 */
export function AppSectionSwitcher({
  activeSection,
  onSectionChange,
}: {
  activeSection: AppSection;
  onSectionChange: (section: AppSection) => void;
}) {
  return (
    <nav
      aria-label="Primary"
      className="grid shrink-0 grid-cols-2 gap-1 rounded-[18px] bg-panel-bg p-1 ring-1 ring-panel-ring transition-colors duration-300 xl:hidden"
    >
      {PRIMARY_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = activeSection === item.id;

        return (
          <button
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[14px] font-medium text-[12px] transition-colors duration-200",
              active
                ? "bg-toolbar-active-bg text-toolbar-active-fg"
                : "text-panel-text-muted hover:bg-input-hover hover:text-panel-text"
            )}
            key={item.id}
            onClick={() => onSectionChange(item.id)}
            type="button"
          >
            <Icon className="size-4" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function SidebarNavButton({
  active,
  collapsed,
  item,
  onSelect,
}: {
  active: boolean;
  collapsed: boolean;
  item: SidebarNavItem;
  onSelect: (section: AppSection) => void;
}) {
  const Icon = item.icon;

  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full cursor-pointer flex-col items-center gap-1 rounded-xl py-2.5 transition-colors duration-200",
        active
          ? "bg-toolbar-active-bg text-toolbar-active-fg"
          : "text-panel-text-muted hover:bg-input-hover hover:text-panel-text"
      )}
      onClick={() => onSelect(item.id)}
      title={collapsed ? item.label : undefined}
      type="button"
    >
      <Icon className="size-5" />
      {collapsed ? null : (
        <span className="font-medium text-[10px] tracking-wide">{item.label}</span>
      )}
    </button>
  );
}
