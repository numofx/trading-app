"use client";

import type { MouseEvent } from "react";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/market-formatting";
import type { SPOT_TIMEFRAME_OPTIONS } from "@/lib/spot-terminal-config";
import { CHART_TOOL_ICONS, CHART_TOOLS } from "@/lib/spot-terminal-config";
import type { Candle, OrderBookLevel } from "@/lib/trading.types";

export type SpotChartTab = "depth" | "price";
export type SpotTimeframe = (typeof SPOT_TIMEFRAME_OPTIONS)[number];

const CHART_WIDTH = 1000;
const CHART_HEIGHT = 440;
const PLOT_LEFT = 10;
const PLOT_RIGHT = 908;
const PRICE_TOP = 14;
const PRICE_BOTTOM = 318;
const VOLUME_TOP = 334;
const VOLUME_BOTTOM = 406;
const TIME_LABEL_Y = 428;
const SMA_PERIOD = 7;

function getPriceScale(candles: Candle[]) {
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const rawMax = Math.max(...highs);
  const rawMin = Math.min(...lows);
  const padding = Math.max((rawMax - rawMin) * 0.08, 0.5);

  return { max: rawMax + padding, min: rawMin - padding };
}

function buildSmaPoints(
  candles: Candle[],
  xForIndex: (index: number) => number,
  yForPrice: (price: number) => number
) {
  const points: string[] = [];

  for (let index = SMA_PERIOD - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - SMA_PERIOD + 1, index + 1);
    const average = window.reduce((sum, candle) => sum + candle.close, 0) / SMA_PERIOD;
    points.push(`${xForIndex(index)},${yForPrice(average)}`);
  }

  return points.join(" ");
}

function CandlestickChart({
  candles,
  hoveredIndex,
  indicatorsEnabled,
  onHoverChange,
}: {
  candles: Candle[];
  hoveredIndex: number | null;
  indicatorsEnabled: boolean;
  onHoverChange: (index: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  if (candles.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px] text-panel-text-muted">
        No chart data
      </div>
    );
  }

  const { max, min } = getPriceScale(candles);
  const priceRange = max - min;
  const slotWidth = (PLOT_RIGHT - PLOT_LEFT) / candles.length;
  const bodyWidth = Math.max(slotWidth * 0.6, 2);
  const maxVolume = Math.max(...candles.map((candle) => candle.volume), 1);
  const timeLabelStep = Math.max(1, Math.ceil(candles.length / 8));
  const gridlineCount = 5;

  function xForIndex(index: number) {
    return PLOT_LEFT + slotWidth * index + slotWidth / 2;
  }

  function yForPrice(price: number) {
    return PRICE_BOTTOM - ((price - min) / priceRange) * (PRICE_BOTTOM - PRICE_TOP);
  }

  function handleMouseMove(event: MouseEvent<HTMLDivElement>) {
    const bounds = containerRef.current?.getBoundingClientRect();

    if (!bounds || bounds.width === 0) {
      return;
    }

    const viewX = ((event.clientX - bounds.left) / bounds.width) * CHART_WIDTH;
    const index = Math.floor((viewX - PLOT_LEFT) / slotWidth);

    if (index < 0 || index >= candles.length) {
      onHoverChange(null);
      return;
    }

    onHoverChange(index);
  }

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Hover only refines the OHLC readout; it defaults to the latest candle without a pointer.
    // biome-ignore lint/a11y/noStaticElementInteractions: Same as above — pointer tracking is a visual enhancement, not an interaction requirement.
    <div
      className="size-full"
      onMouseLeave={() => onHoverChange(null)}
      onMouseMove={handleMouseMove}
      ref={containerRef}
    >
      <svg
        aria-label="USDC/cNGN candlestick chart"
        className="size-full"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      >
        {Array.from({ length: gridlineCount }, (_, lineIndex) => {
          const price = min + (priceRange / (gridlineCount - 1)) * lineIndex;
          const y = yForPrice(price);

          return (
            <g key={price}>
              <line
                stroke="var(--chart-grid-stroke)"
                strokeDasharray="4 8"
                x1={PLOT_LEFT}
                x2={PLOT_RIGHT}
                y1={y}
                y2={y}
              />
              <text
                fill="var(--chart-label-fill)"
                fontSize="11"
                textAnchor="start"
                x={PLOT_RIGHT + 10}
                y={y + 4}
              >
                {formatNaira(price, 1)}
              </text>
            </g>
          );
        })}

        {candles.map((candle, index) => {
          const isUp = candle.close >= candle.open;
          const color = isUp ? "var(--bid-text)" : "var(--ask-text)";
          const x = xForIndex(index);
          const bodyTop = yForPrice(Math.max(candle.open, candle.close));
          const bodyBottom = yForPrice(Math.min(candle.open, candle.close));
          const bodyHeight = Math.max(bodyBottom - bodyTop, 1);
          const volumeHeight = (candle.volume / maxVolume) * (VOLUME_BOTTOM - VOLUME_TOP);
          const isDimmed = hoveredIndex !== null && hoveredIndex !== index;

          return (
            <g key={`${candle.time}-${index}`} opacity={isDimmed ? 0.55 : 1}>
              <line
                stroke={color}
                strokeWidth="1.4"
                x1={x}
                x2={x}
                y1={yForPrice(candle.high)}
                y2={yForPrice(candle.low)}
              />
              <rect
                fill={color}
                height={bodyHeight}
                width={bodyWidth}
                x={x - bodyWidth / 2}
                y={bodyTop}
              />
              <rect
                fill={color}
                height={Math.max(volumeHeight, 1)}
                opacity="0.45"
                width={bodyWidth}
                x={x - bodyWidth / 2}
                y={VOLUME_BOTTOM - Math.max(volumeHeight, 1)}
              />
              {index % timeLabelStep === 0 ? (
                <text
                  fill="var(--chart-label-fill)"
                  fontSize="10"
                  textAnchor="middle"
                  x={x}
                  y={TIME_LABEL_Y}
                >
                  {candle.time}
                </text>
              ) : null}
            </g>
          );
        })}

        {indicatorsEnabled && candles.length >= SMA_PERIOD ? (
          <polyline
            fill="none"
            points={buildSmaPoints(candles, xForIndex, yForPrice)}
            stroke="var(--spread-percent)"
            strokeWidth="2"
          />
        ) : null}

        {hoveredIndex !== null ? (
          <g>
            <line
              stroke="var(--chart-axis-stroke)"
              strokeDasharray="3 5"
              x1={xForIndex(hoveredIndex)}
              x2={xForIndex(hoveredIndex)}
              y1={PRICE_TOP}
              y2={VOLUME_BOTTOM}
            />
            <line
              stroke="var(--chart-axis-stroke)"
              strokeDasharray="3 5"
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={yForPrice(candles[hoveredIndex].close)}
              y2={yForPrice(candles[hoveredIndex].close)}
            />
          </g>
        ) : null}

        <line
          stroke="var(--chart-axis-stroke)"
          x1={PLOT_LEFT}
          x2={PLOT_RIGHT}
          y1={VOLUME_BOTTOM}
          y2={VOLUME_BOTTOM}
        />
      </svg>
    </div>
  );
}

function buildDepthSeries(levels: OrderBookLevel[]) {
  let cumulative = 0;

  return levels.map((level) => {
    cumulative += level.size;
    return { cumulative, price: level.price };
  });
}

function DepthChart({ asks, bids }: { asks: OrderBookLevel[]; bids: OrderBookLevel[] }) {
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;

  if (bestBid === null || bestAsk === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px] text-panel-text-muted">
        No book data
      </div>
    );
  }

  // Depth accumulates outward from the mid price on both sides.
  const bidSeries = buildDepthSeries(bids);
  const askSeries = buildDepthSeries(asks);
  const midPrice = (bestBid + bestAsk) / 2;
  const minPrice = Math.min(...bids.map((level) => level.price));
  const maxPrice = Math.max(...asks.map((level) => level.price));
  const priceRange = maxPrice - minPrice || 1;
  const maxDepth = Math.max(
    bidSeries.at(-1)?.cumulative ?? 0,
    askSeries.at(-1)?.cumulative ?? 0,
    1
  );
  const depthTop = 20;
  const depthBottom = 386;

  function xForPrice(price: number) {
    return PLOT_LEFT + ((price - minPrice) / priceRange) * (PLOT_RIGHT - PLOT_LEFT);
  }

  function yForDepth(depth: number) {
    return depthBottom - (depth / maxDepth) * (depthBottom - depthTop);
  }

  function buildStepPath(series: { cumulative: number; price: number }[], edgePrice: number) {
    if (series.length === 0) {
      return "";
    }

    const segments = [
      `M ${xForPrice(series[0].price)} ${depthBottom}`,
      `L ${xForPrice(series[0].price)} ${yForDepth(series[0].cumulative)}`,
    ];

    for (let index = 1; index < series.length; index += 1) {
      const x = xForPrice(series[index].price);
      segments.push(`L ${x} ${yForDepth(series[index - 1].cumulative)}`);
      segments.push(`L ${x} ${yForDepth(series[index].cumulative)}`);
    }

    const lastDepth = series.at(-1)?.cumulative ?? 0;
    segments.push(`L ${xForPrice(edgePrice)} ${yForDepth(lastDepth)}`);
    segments.push(`L ${xForPrice(edgePrice)} ${depthBottom}`);
    segments.push("Z");

    return segments.join(" ");
  }

  const gridlineCount = 4;
  const timeLabelPrices = [minPrice, midPrice, maxPrice];

  return (
    <svg
      aria-label="USDC/cNGN market depth chart"
      className="size-full"
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
    >
      {Array.from({ length: gridlineCount }, (_, lineIndex) => {
        const depth = (maxDepth / (gridlineCount - 1)) * lineIndex;
        const y = yForDepth(depth);

        return (
          <g key={depth}>
            <line
              stroke="var(--chart-grid-stroke)"
              strokeDasharray="4 8"
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={y}
              y2={y}
            />
            <text
              fill="var(--chart-label-fill)"
              fontSize="11"
              textAnchor="start"
              x={PLOT_RIGHT + 10}
              y={y + 4}
            >
              {Math.round(depth).toLocaleString("en-US")}
            </text>
          </g>
        );
      })}

      <path
        d={buildStepPath(bidSeries, minPrice)}
        fill="var(--bid-bg)"
        stroke="var(--bid-text)"
        strokeWidth="2"
      />
      <path
        d={buildStepPath(askSeries, maxPrice)}
        fill="var(--ask-bg)"
        stroke="var(--ask-text)"
        strokeWidth="2"
      />

      <line
        stroke="var(--chart-axis-stroke)"
        strokeDasharray="3 6"
        x1={xForPrice(midPrice)}
        x2={xForPrice(midPrice)}
        y1={depthTop - 6}
        y2={depthBottom}
      />
      <text
        fill="var(--chart-label-fill)"
        fontSize="11"
        textAnchor="middle"
        x={xForPrice(midPrice)}
        y={depthTop - 10}
      >
        Mid {formatNaira(midPrice)}
      </text>

      <line
        stroke="var(--chart-axis-stroke)"
        x1={PLOT_LEFT}
        x2={PLOT_RIGHT}
        y1={depthBottom}
        y2={depthBottom}
      />

      {timeLabelPrices.map((price) => (
        <text
          fill="var(--chart-label-fill)"
          fontSize="10"
          key={price}
          textAnchor="middle"
          x={xForPrice(price)}
          y={TIME_LABEL_Y}
        >
          {formatNaira(price, 0)}
        </text>
      ))}
    </svg>
  );
}

function OhlcReadout({ candle }: { candle: Candle | null }) {
  if (!candle) {
    return null;
  }

  const changePercent = candle.open > 0 ? ((candle.close - candle.open) / candle.open) * 100 : 0;
  const isUp = candle.close >= candle.open;
  const valueClass = isUp ? "text-bid-text" : "text-ask-text";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
      {(
        [
          ["O", candle.open],
          ["H", candle.high],
          ["L", candle.low],
          ["C", candle.close],
        ] as const
      ).map(([label, value]) => (
        <span className="flex items-center gap-1" key={label}>
          <span className="text-panel-text-muted">{label}</span>
          <span className={cn("font-medium", valueClass)}>{formatNaira(value)}</span>
        </span>
      ))}
      <span className={cn("font-medium", valueClass)}>
        {isUp ? "+" : ""}
        {changePercent.toFixed(2)}%
      </span>
      <span className="flex items-center gap-1">
        <span className="text-panel-text-muted">Vol</span>
        <span className="font-medium text-panel-text">
          {candle.volume.toLocaleString("en-US")} USDC
        </span>
      </span>
    </div>
  );
}

export function SpotChartPanel({
  asks,
  bids,
  candles,
  chartTab,
  indicatorsEnabled,
  onChartTabChange,
  onIndicatorsToggle,
  onTimeframeChange,
  onToolSelect,
  selectedTimeframe,
  selectedTool,
  timeframes,
}: {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  candles: Candle[];
  chartTab: SpotChartTab;
  indicatorsEnabled: boolean;
  onChartTabChange: (tab: SpotChartTab) => void;
  onIndicatorsToggle: () => void;
  onTimeframeChange: (timeframe: SpotTimeframe) => void;
  onToolSelect: (toolId: string) => void;
  selectedTimeframe: SpotTimeframe;
  selectedTool: string;
  timeframes: readonly SpotTimeframe[];
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const readoutCandle =
    hoveredIndex !== null ? (candles[hoveredIndex] ?? null) : (candles.at(-1) ?? null);

  return (
    <section className="flex h-full min-h-[380px] flex-col overflow-hidden bg-panel-bg-muted ring-1 ring-panel-ring transition-colors duration-300 xl:min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-panel-border border-b px-3 py-2">
        <div className="flex items-center gap-1.5 font-medium text-[11px]">
          <button
            className={cn(
              "cursor-pointer rounded-sm px-2 py-1 transition-colors",
              chartTab === "price"
                ? "bg-input-bg text-panel-text-active"
                : "text-panel-text-muted hover:text-panel-text"
            )}
            onClick={() => onChartTabChange("price")}
            type="button"
          >
            Price chart
          </button>
          <button
            className={cn(
              "cursor-pointer rounded-sm px-2 py-1 transition-colors",
              chartTab === "depth"
                ? "bg-input-bg text-panel-text-active"
                : "text-panel-text-muted hover:text-panel-text"
            )}
            onClick={() => onChartTabChange("depth")}
            type="button"
          >
            Depth chart
          </button>
        </div>

        {chartTab === "price" ? (
          <div className="flex flex-wrap items-center gap-1">
            {timeframes.map((timeframe) => (
              <button
                className={cn(
                  "h-7 cursor-pointer rounded-sm px-2 font-medium text-[10px] transition-colors",
                  selectedTimeframe === timeframe
                    ? "bg-toolbar-active-bg text-toolbar-active-fg"
                    : "text-panel-text-muted hover:bg-input-hover hover:text-panel-text-active"
                )}
                key={timeframe}
                onClick={() => onTimeframeChange(timeframe)}
                type="button"
              >
                {timeframe}
              </button>
            ))}
            <button
              className={cn(
                "h-7 cursor-pointer rounded-sm px-2 font-medium text-[10px] transition-colors",
                indicatorsEnabled
                  ? "bg-toolbar-active-bg text-toolbar-active-fg"
                  : "text-panel-text-muted hover:bg-input-hover hover:text-panel-text-active"
              )}
              onClick={onIndicatorsToggle}
              type="button"
            >
              Indicators
            </button>
          </div>
        ) : null}
      </div>

      {chartTab === "price" ? (
        <div className="border-panel-border border-b px-3 py-1.5">
          <OhlcReadout candle={readoutCandle} />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {chartTab === "price" ? (
          <div className="flex w-9 shrink-0 flex-col items-center gap-1 overflow-y-auto border-panel-border border-r px-1 py-2">
            {CHART_TOOLS.map((tool) => {
              const Icon = CHART_TOOL_ICONS[tool.id];

              return (
                <button
                  className={cn(
                    "flex size-6.5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text-active",
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
        ) : null}

        <div className="min-h-0 min-w-0 flex-1 p-2">
          {chartTab === "price" ? (
            <CandlestickChart
              candles={candles}
              hoveredIndex={hoveredIndex}
              indicatorsEnabled={indicatorsEnabled}
              onHoverChange={setHoveredIndex}
            />
          ) : (
            <DepthChart asks={asks} bids={bids} />
          )}
        </div>
      </div>
    </section>
  );
}
