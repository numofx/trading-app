import type { ReactNode } from "react";
import { ChevronDown, Expand, Gauge, Redo2, Settings2 } from "lucide-react";
import { CHART_TOOL_ICONS, CHART_TOOLS } from "@/lib/mock-trading-data";
import { cn } from "@/lib/cn";

function ToolbarButton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-sm border border-[#1B2430] bg-[#151B23] px-2.5 font-medium text-[#6B7280] text-xs transition-colors hover:border-[#334155] hover:text-[#D1D5DB]",
        className,
      )}
      type="button"
    >
      {children}
    </button>
  );
}

export function ChartToolbar({ mode = "top" }: { mode?: "side" | "top" }) {
  if (mode === "side") {
    return (
      <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-[#1B2430] border-r bg-[#11161D] px-1 py-2">
        {CHART_TOOLS.map((tool) => {
          const Icon = CHART_TOOL_ICONS[tool.id];

          return (
            <button
              className="flex size-8 items-center justify-center rounded-sm text-[#6B7280] transition-colors hover:bg-[#151B23] hover:text-[#D1D5DB]"
              key={tool.id}
              title={tool.label}
              type="button"
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between border-[#1B2430] border-b px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {["5m", "1h", "D"].map((range, index) => (
          <ToolbarButton
            className={index === 1 ? "border-[#3B82F6] bg-[#172554]/60 text-[#BFDBFE]" : undefined}
            key={range}
          >
            {range}
          </ToolbarButton>
        ))}

        <ToolbarButton className="px-2">
          <ChevronDown className="size-4" />
        </ToolbarButton>

        <ToolbarButton className="px-2">
          <Gauge className="size-4" />
        </ToolbarButton>

        <ToolbarButton className="px-2">
          <Settings2 className="size-4" />
        </ToolbarButton>

        <ToolbarButton>Indicators</ToolbarButton>
      </div>

      <div className="flex items-center gap-2">
        <ToolbarButton className="px-2">
          <Redo2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton className="px-2">
          <Expand className="size-4" />
        </ToolbarButton>
      </div>
    </div>
  );
}
