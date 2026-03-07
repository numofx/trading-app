import { CHART_CANDLES, CHART_CONTEXT_TABS, CHART_RANGE_BUTTONS } from "@/lib/mock-trading-data";
import { cn } from "@/lib/cn";
import { ChartToolbar } from "@/ui/trading-terminal/ChartToolbar";

type Point = {
  closeY: number;
  highY: number;
  lowY: number;
  openY: number;
  volumeHeight: number;
  x: number;
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value % 1 === 0 ? 0 : 1,
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
  }).format(value);
}

function TradingChart() {
  const width = 920;
  const height = 620;
  const volumeHeight = 128;
  const chartTop = 28;
  const chartBottom = height - volumeHeight - 28;
  const minPrice = Math.min(...CHART_CANDLES.map((candle) => candle.low)) - 60;
  const maxPrice = Math.max(...CHART_CANDLES.map((candle) => candle.high)) + 60;
  const priceRange = maxPrice - minPrice;
  const stepX = width / CHART_CANDLES.length;
  const candleWidth = Math.max(9, stepX * 0.62);
  const maxVolume = Math.max(...CHART_CANDLES.map((candle) => candle.volume));
  const lastCandle = CHART_CANDLES.at(-1);

  if (!lastCandle) {
    return null;
  }

  const points = CHART_CANDLES.map((candle, index) => {
    const x = index * stepX + stepX / 2;
    const highY = chartTop + ((maxPrice - candle.high) / priceRange) * (chartBottom - chartTop);
    const lowY = chartTop + ((maxPrice - candle.low) / priceRange) * (chartBottom - chartTop);
    const openY = chartTop + ((maxPrice - candle.open) / priceRange) * (chartBottom - chartTop);
    const closeY = chartTop + ((maxPrice - candle.close) / priceRange) * (chartBottom - chartTop);

    return {
      closeY,
      highY,
      lowY,
      openY,
      volumeHeight: (candle.volume / maxVolume) * (volumeHeight - 12),
      x,
    } satisfies Point;
  });

  const currentPriceY =
    chartTop + ((maxPrice - lastCandle.close) / priceRange) * (chartBottom - chartTop);
  const axisValues = Array.from({ length: 6 }, (_, index) => maxPrice - (priceRange / 5) * index);

  return (
    <div className="relative flex-1 overflow-hidden">
      <div className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[11px]">
        <span className="font-semibold text-[#E5E7EB]">USD/NGN JUN 2026 · 1h · Central Limit Order Book</span>
        <span className="text-[#6B7280]">
          O1,604.9 H1,606.1 L1,604.5 C1,605.2
          <span className="ml-2 text-[#6FBF86]">+0.3 (+0.02%)</span>
        </span>
      </div>

      <svg
        aria-label="Mock USD/NGN futures candlestick chart"
        className="size-full"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <pattern height="68" id="gridPattern" patternUnits="userSpaceOnUse" width="92">
            <path d="M 92 0 L 0 0 0 68" fill="none" stroke="#16202A" strokeWidth="0.7" />
          </pattern>
        </defs>

        <rect fill="url(#gridPattern)" height={height} width={width} x="0" y="0" />

        {axisValues.map((value) => {
          const y = chartTop + ((maxPrice - value) / priceRange) * (chartBottom - chartTop);

          return (
            <g key={value}>
              <line stroke="#16202A" strokeDasharray="4 6" x1="0" x2={width} y1={y} y2={y} />
              <text fill="#6B7280" fontSize="11" textAnchor="end" x={width - 8} y={y - 6}>
                {formatPrice(value)}
              </text>
            </g>
          );
        })}

        {points.map((point, index) => {
          const candle = CHART_CANDLES[index];
          const isBullish = candle.close >= candle.open;
          const bodyTop = Math.min(point.openY, point.closeY);
          const bodyHeight = Math.max(Math.abs(point.closeY - point.openY), 3);
          const color = isBullish ? "#15803D" : "#B91C1C";
          const volumeY = height - point.volumeHeight - 18;

          return (
            <g key={candle.time}>
              <line stroke={color} strokeWidth="1.5" x1={point.x} x2={point.x} y1={point.highY} y2={point.lowY} />
              <rect
                fill={color}
                height={bodyHeight}
                rx="1"
                width={candleWidth}
                x={point.x - candleWidth / 2}
                y={bodyTop}
              />
              <rect
                fill={isBullish ? "#123524" : "#4D1717"}
                height={point.volumeHeight}
                opacity="0.72"
                width={Math.max(6, candleWidth)}
                x={point.x - Math.max(6, candleWidth) / 2}
                y={volumeY}
              />
            </g>
          );
        })}

        <line
          stroke="#3B82F6"
          strokeDasharray="3 5"
          strokeWidth="1"
          x1="0"
          x2={width}
          y1={currentPriceY}
          y2={currentPriceY}
        />

        <g>
          <rect fill="#1D4ED8" height="22" rx="4" width="64" x={width - 70} y={currentPriceY - 11} />
          <text
            fill="#EFF6FF"
            fontSize="12"
            fontWeight="700"
            textAnchor="middle"
            x={width - 38}
            y={currentPriceY + 4}
          >
            1,605.2
          </text>
        </g>

        {CHART_CANDLES.filter((_, index) => index % 4 === 0).map((candle, index) => {
          const sourceIndex = index * 4;
          const x = sourceIndex * stepX + stepX / 2;

          return (
            <text
              fill="#6B7280"
              fontSize="11"
              key={candle.time}
              textAnchor="middle"
              x={x}
              y={height - 4}
            >
              {candle.time}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export function ChartPanel() {
  return (
    <section className="flex h-full min-h-[540px] flex-col overflow-hidden rounded-md border border-[#1B2430] bg-[#0F1720] xl:min-h-0">
      <ChartToolbar />

      <div className="flex min-h-0 flex-1">
        <div className="hidden xl:block">
          <ChartToolbar mode="side" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-[#1B2430] border-b bg-[#0F1720] px-2.5 py-1">
            <div className="flex items-center gap-1">
              {CHART_CONTEXT_TABS.map((tab) => (
                <button
                  className={cn(
                    "rounded-sm px-2 py-1 font-medium text-[#6B7280] text-[11px] transition-colors hover:bg-[#11161D] hover:text-[#D1D5DB]",
                    tab === "Futures" && "bg-[#11161D] text-[#BFDBFE]",
                  )}
                  key={tab}
                  type="button"
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="text-[#6B7280] text-[11px]">Price in NGN per 1 USD</div>
          </div>

          <TradingChart />

          <div className="flex items-center justify-between border-[#1B2430] border-t bg-[#0F1720] px-2.5 py-1 text-[11px]">
            <div className="flex flex-wrap items-center gap-1">
              {CHART_RANGE_BUTTONS.map((range) => (
                <button
                  className={cn(
                    "rounded-sm px-2 py-1 text-[#6B7280] transition-colors hover:bg-[#11161D] hover:text-[#D1D5DB]",
                    range === "1d" && "bg-[#11161D] text-[#BFDBFE]",
                  )}
                  key={range}
                  type="button"
                >
                  {range}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 text-[#6B7280]">
              <span>13:37:35 (UTC-5)</span>
              <button type="button">%</button>
              <button type="button">log</button>
              <button className="text-[#D1D5DB]" type="button">
                auto
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
