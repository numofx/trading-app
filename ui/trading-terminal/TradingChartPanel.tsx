"use client";

import { useState } from "react";
import type { Candle } from "@/lib/trading.types";
import type { CHART_CONTEXT_TABS, CHART_RANGE_BUTTONS, TIMEFRAME_OPTIONS } from "@/lib/mock-orderbook-terminal-data";
import { cn } from "@/lib/cn";
import { SmartImage } from "@/ui/SmartImage";

export const FORWARD_POINTS = [
  { basis: null, label: "Spot", rate: 1500, tenor: "Spot" },
  { basis: 3.2, label: "Jun 2026", rate: 1545, tenor: "1M" },
  { basis: 7.3, label: "Nov 2026", rate: 1720, tenor: "6M" },
  { basis: 9.6, label: "May 2027", rate: 1820, tenor: "12M" },
] as const;

function formatNaira(value: number) {
  return `₦${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatBasis(value: number | null) {
  if (value === null) {
    return "—";
  }

  return `+${value.toFixed(1)}%`;
}

function buildCurvePath(points: { x: number; y: number }[]) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function getPairLabel(ticker: string) {
  const [pair] = ticker.split(" ");
  return pair?.trim() || "USDC/cNGN";
}

function ForwardCurveChart({ activeIndex }: { activeIndex: number }) {
  const width = 1000;
  const height = 210;
  const plotLeft = 115;
  const plotRight = 960;
  const plotTop = 12;
  const plotBottom = 168;
  const minRate = 1300;
  const maxRate = 1850;
  const rateRange = maxRate - minRate;
  const visiblePoints = FORWARD_POINTS;
  const chartPoints = visiblePoints.map((point, index) => {
    const x = plotLeft + (index / (visiblePoints.length - 1)) * (plotRight - plotLeft);
    const y = plotBottom - ((point.rate - minRate) / rateRange) * (plotBottom - plotTop);

    return { ...point, x, y };
  });
  const path = buildCurvePath(chartPoints);
  const areaPath = `${path} L ${chartPoints.at(-1)?.x ?? plotRight} ${plotBottom} L ${chartPoints[0]?.x ?? plotLeft} ${plotBottom} Z`;
  const gridLines = [1800, 1700, 1600, 1500, 1400, 1300];

  return (
    <svg
      aria-label="USDC/cNGN forward curve"
      className="size-full max-h-[214px] min-h-0"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <defs>
        <linearGradient id="forwardCurveFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-area-stop-0)" />
          <stop offset="100%" stopColor="var(--chart-area-stop-100)" />
        </linearGradient>
      </defs>

      {gridLines.map((rate) => {
        const y = plotBottom - ((rate - minRate) / rateRange) * (plotBottom - plotTop);

        return (
          <g key={rate}>
            <line stroke="var(--chart-grid-stroke)" strokeDasharray="5 9" x1={plotLeft - 28} x2={plotRight + 20} y1={y} y2={y} />
            <text fill="var(--chart-label-fill)" fontSize="12" textAnchor="end" x={plotLeft - 44} y={y + 4}>
              {rate.toLocaleString("en-US")}
            </text>
          </g>
        );
      })}

      <path d={areaPath} fill="url(#forwardCurveFill)" />
      <path d={path} fill="none" stroke="var(--chart-curve)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />

      {chartPoints.map((point) => {
        const sourceIndex = FORWARD_POINTS.findIndex((candidate) => candidate.tenor === point.tenor);
        const isActive = sourceIndex === activeIndex;

        return (
          <g key={point.tenor}>
            <circle
              cx={point.x}
              cy={point.y}
              fill={isActive ? "var(--chart-curve)" : "var(--chart-label-fill)"}
              r={isActive ? 7 : 5.5}
              stroke={isActive ? "var(--chart-curve)" : "var(--chart-axis-stroke)"}
              strokeWidth="2"
            />
          </g>
        );
      })}

      <line stroke="var(--chart-axis-stroke)" x1={plotLeft - 28} x2={plotRight + 20} y1={plotBottom} y2={plotBottom} />

      {chartPoints.map((point) => (
        <text fill="var(--chart-label-fill)" fontSize="13" key={`axis-${point.tenor}`} textAnchor="middle" x={point.x} y={plotBottom + 27}>
          {point.tenor}
        </text>
      ))}
    </svg>
  );
}

export function TradingChartPanel({
  chartContext,
  ticker,
  onChartContextChange,
  activeIndex,
  onActiveIndexChange,
}: {
  candles: Candle[];
  chartContext: (typeof CHART_CONTEXT_TABS)[number];
  entryPrice: string;
  expandedChart: boolean;
  indicatorsEnabled: boolean;
  markPrice: string;
  selectedRange: (typeof CHART_RANGE_BUTTONS)[number];
  selectedTimeframe: (typeof TIMEFRAME_OPTIONS)[number];
  selectedTool: string;
  ticker: string;
  onChartContextChange: (context: (typeof CHART_CONTEXT_TABS)[number]) => void;
  onExpandedToggle: () => void;
  onIndicatorsToggle: () => void;
  onRangeChange: (range: (typeof CHART_RANGE_BUTTONS)[number]) => void;
  onTimeframeChange: (timeframe: (typeof TIMEFRAME_OPTIONS)[number]) => void;
  onToolSelect: (toolId: string) => void;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
}) {
  const pairLabel = getPairLabel(ticker);

  return (
    <section className="flex h-full min-h-[320px] flex-col overflow-hidden rounded-[28px] bg-panel-bg p-5 text-foreground shadow-[0_28px_90px_var(--panel-shadow)] ring-1 ring-panel-ring transition-colors duration-300 xl:min-h-0">
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex shrink-0 animate-none items-center -space-x-1.5">
            <SmartImage<string> alt="USDC" className="size-7 animate-none rounded-full bg-input-bg p-0.5 ring-2 ring-panel-bg" src="/tokens/usdc.svg" />
            <SmartImage<string> alt="cNGN" className="size-7 animate-none rounded-full bg-input-bg p-0.5 ring-2 ring-panel-bg" src="/tokens/cngn.svg" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="truncate font-semibold text-[22px] leading-none tracking-[-0.02em]">{pairLabel}</h2>
            <span className="font-medium text-[13px] text-panel-text-muted leading-none">Nigerian naira futures</span>
          </div>
        </div>
      </div>

      <div className="mt-7 grid gap-3 md:grid-cols-3">
        {FORWARD_POINTS.slice(1).map((point) => {
          const sourceIndex = FORWARD_POINTS.findIndex((candidate) => candidate.tenor === point.tenor);
          const isActive = sourceIndex === activeIndex;

          return (
            <button
              className={cn(
                "rounded-[16px] bg-input-bg p-4 text-left transition-all duration-300",
                isActive
                  ? "ring-2 ring-panel-text-active"
                  : "ring-1 ring-panel-border hover:ring-panel-text-active/60",
              )}
              key={point.tenor}
              onClick={() => {
                onActiveIndexChange(sourceIndex);
                onChartContextChange("Basis");
              }}
              type="button"
            >
              <div className="font-medium text-[13px] text-panel-text">{point.label}</div>
              <div className="mt-3 font-semibold text-[22px] text-panel-text-active tracking-[-0.03em]">{formatNaira(point.rate)}</div>
              <div className="mt-1 text-[13px] text-panel-text-muted">{formatBasis(point.basis)}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-7 text-[13px] text-panel-text-muted">cNGN per USDC</div>
      <div className="min-h-0 flex-1">
        <ForwardCurveChart activeIndex={activeIndex} />
      </div>

      <div className="sr-only">
        {chartContext}
      </div>
    </section>
  );
}
