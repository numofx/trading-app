import type { ReactNode } from "react";
import { ChevronDown, Expand, Gauge, Redo2, Settings2 } from "lucide-react";
import { CHART_TOOL_ICONS, CHART_TOOLS, TIMEFRAME_OPTIONS } from "@/lib/mock-trading-data";
import { cn } from "@/lib/cn";

function ToolbarButton({
  active = false,
  children,
  className,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-sm border border-[#1B2430] bg-[#11161D] px-3 font-semibold text-[#6B7280] text-xs transition-colors hover:border-[#334155] hover:text-[#D1D5DB]",
        active && "border-[#2563EB] bg-[#172554]/40 text-[#BFDBFE]",
        className,
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export function ChartToolbar({
  expandedChart,
  indicatorsEnabled,
  mode = "top",
  selectedTimeframe,
  selectedTool,
  onExpandedToggle,
  onIndicatorsToggle,
  onTimeframeChange,
  onToolSelect,
}: {
  expandedChart: boolean;
  indicatorsEnabled: boolean;
  mode?: "side" | "top";
  selectedTimeframe: string;
  selectedTool: string;
  onExpandedToggle: () => void;
  onIndicatorsToggle: () => void;
  onTimeframeChange: (timeframe: (typeof TIMEFRAME_OPTIONS)[number]) => void;
  onToolSelect: (toolId: string) => void;
}) {
  if (mode === "side") {
    return (
      <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-[#1B2430] border-r bg-[#11161D] px-1 py-2">
        {CHART_TOOLS.map((tool) => {
          const Icon = CHART_TOOL_ICONS[tool.id];

          return (
            <button
              className={cn(
                "flex size-8 items-center justify-center rounded-sm text-[#6B7280] transition-colors hover:bg-[#151B23] hover:text-[#D1D5DB]",
                selectedTool === tool.id && "bg-[#151B23] text-[#BFDBFE]",
              )}
              key={tool.id}
              onClick={() => onToolSelect(tool.id)}
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
    <div className="flex items-center justify-between border-[#1B2430] border-b px-2.5 py-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {TIMEFRAME_OPTIONS.map((range) => (
          <ToolbarButton
            active={selectedTimeframe === range}
            key={range}
            onClick={() => onTimeframeChange(range)}
          >
            {range}
          </ToolbarButton>
        ))}

        <ToolbarButton onClick={() => onToolSelect("cursor")} className="px-2">
          <ChevronDown className="size-4" />
        </ToolbarButton>

        <ToolbarButton active={selectedTool === "measure"} className="px-2" onClick={() => onToolSelect("measure")}>
          <Gauge className="size-4" />
        </ToolbarButton>

        <ToolbarButton active={selectedTool === "candles"} className="px-2" onClick={() => onToolSelect("candles")}>
          <Settings2 className="size-4" />
        </ToolbarButton>

        <ToolbarButton active={indicatorsEnabled} onClick={onIndicatorsToggle}>
          Indicators
        </ToolbarButton>
      </div>

      <div className="flex items-center gap-1.5">
        <ToolbarButton className="px-2" onClick={() => onToolSelect("crosshair")}>
          <Redo2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton active={expandedChart} className="px-2" onClick={onExpandedToggle}>
          <Expand className="size-4" />
        </ToolbarButton>
      </div>
    </div>
  );
}
