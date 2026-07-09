"use client";

import type { LucideIcon } from "lucide-react";
import {
  ChartColumn,
  ChartPie,
  ChevronsLeft,
  ChevronsRight,
  Diamond,
  Ellipsis,
  FileText,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { AppSection } from "@/ui/app-sidebar.types";

type SidebarNavItem = {
  icon: LucideIcon;
  id: AppSection;
  label: string;
};

const PRIMARY_NAV_ITEMS = [
  { icon: Globe, id: "markets", label: "Markets" },
  { icon: ChartColumn, id: "spot", label: "Spot" },
  { icon: Diamond, id: "derivatives", label: "Derivatives" },
  { icon: ChartPie, id: "portfolio", label: "Portfolio" },
  { icon: FileText, id: "orders", label: "Orders" },
] satisfies SidebarNavItem[];

const MORE_NAV_ITEM = { icon: Ellipsis, id: "more", label: "More" } satisfies SidebarNavItem;

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
        "sticky top-0 flex h-dvh shrink-0 flex-col justify-between self-start border-panel-border border-r bg-panel-bg px-2 py-3 transition-all duration-300",
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

        <SidebarNavButton
          active={activeSection === MORE_NAV_ITEM.id}
          collapsed={collapsed}
          item={MORE_NAV_ITEM}
          onSelect={onSectionChange}
        />
      </div>
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
      {collapsed ? null : <span className="font-medium text-[10px] tracking-wide">{item.label}</span>}
    </button>
  );
}
