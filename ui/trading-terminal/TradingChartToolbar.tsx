import type { ReactNode } from "react";
import { ChevronDown, Expand, Gauge, Redo2 } from "lucide-react";
import {
  CHART_TOOL_ICONS,
  CHART_TOOLS,
  TIMEFRAME_OPTIONS,
} from "@/lib/mock-orderbook-terminal-data";
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
        "inline-flex h-7 items-center gap-1.5 rounded-xl px-2 font-medium text-[10px] text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text-active",
        active && "bg-toolbar-active-bg text-toolbar-active-fg",
        className
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export function TradingChartToolbar({
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
      <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-toolbar-border border-r px-1 py-2.5">
        {CHART_TOOLS.map((tool) => {
          const Icon = CHART_TOOL_ICONS[tool.id];

          return (
            <button
              className={cn(
                "flex size-6.5 items-center justify-center rounded-lg text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text-active",
                selectedTool === tool.id && "bg-toolbar-active-bg text-toolbar-active-fg"
              )}
              key={tool.id}
              onClick={() => onToolSelect(tool.id)}
              title={tool.label}
              type="button"
            >
              <Icon className="size-3" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between border-toolbar-border border-b px-3 py-2">
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

        <ToolbarButton onClick={() => onToolSelect("cursor")} className="px-2.5">
          <ChevronDown className="size-3.5" />
        </ToolbarButton>

        <ToolbarButton
          active={selectedTool === "measure"}
          className="px-2.5"
          onClick={() => onToolSelect("measure")}
        >
          <Gauge className="size-3.5" />
        </ToolbarButton>

        <ToolbarButton active={indicatorsEnabled} onClick={onIndicatorsToggle}>
          Indicators
        </ToolbarButton>
      </div>

      <div className="flex items-center gap-1.5">
        <ToolbarButton className="px-2.5" onClick={() => onToolSelect("crosshair")}>
          <Redo2 className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton active={expandedChart} className="px-2.5" onClick={onExpandedToggle}>
          <Expand className="size-3.5" />
        </ToolbarButton>
      </div>
    </div>
  );
}
