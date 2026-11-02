"use client";

import { useState } from "react";
import { formatPremium } from "@/lib/option-chain";
import type { OptionPayoff } from "@/lib/option-payoff";
import { formatPayoffUsd, optionPnlAt } from "@/lib/option-payoff";
import { PanelTitle } from "@/ui/trading-terminal/PanelTabs";

const WIDTH = 296;
const HEIGHT = 150;
const PLOT = { bottom: 128, left: 44, right: 288, top: 10 };
const X_TICKS = 3;

function Stat({
  align,
  label,
  tone,
  value,
}: {
  align: string;
  label: string;
  tone?: string;
  value: string;
}) {
  return (
    <div className={align}>
      <div className="text-[11px] text-panel-text-muted">{label}</div>
      <div className={`text-[12px] tabular-nums ${tone ?? "text-panel-text"}`}>{value}</div>
    </div>
  );
}

/** Under the chart when nothing is hovered: what its dashed line marks. */
function restingCaption(forward: number | null) {
  return forward === null ? "Settlement price at expiry" : `Forward ${formatPremium(forward)}`;
}

function PayoffChart({
  cost,
  forward,
  payoff,
  size,
  strike,
  type,
}: {
  cost: number;
  forward: number | null;
  payoff: OptionPayoff;
  size: number;
  strike: number;
  type: "call" | "put";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const row = { optionType: type, strike };
  const prices = payoff.points.map((point) => point.settlement);
  const pnls = payoff.points.map((point) => point.pnl);
  const xLow = Math.min(...prices);
  const xHigh = Math.max(...prices);
  const yHigh = Math.max(0, ...pnls);
  const yLow = Math.min(0, ...pnls);
  const pad = (yHigh - yLow) * 0.08;
  const x = (price: number) =>
    PLOT.left + ((price - xLow) / (xHigh - xLow)) * (PLOT.right - PLOT.left);
  const y = (pnl: number) =>
    PLOT.bottom - ((pnl - (yLow - pad)) / (yHigh + pad - (yLow - pad))) * (PLOT.bottom - PLOT.top);

  // The line crosses zero at the breakeven: profit above it, loss below, each in its own colour.
  const ordered = [...payoff.points, { pnl: 0, settlement: payoff.breakeven }].sort(
    (left, right) => left.settlement - right.settlement
  );
  const path = (from: (pnl: number) => boolean) =>
    ordered
      .filter((point) => from(point.pnl))
      .map((point) => `${x(point.settlement)},${y(point.pnl)}`)
      .join(" ");
  const profitLine = path((pnl) => pnl >= 0);
  const lossLine = path((pnl) => pnl <= 0);
  const profitArea = ordered.filter((point) => point.pnl >= 0);
  const area = profitArea
    .map((point) => `${x(point.settlement)},${y(point.pnl)}`)
    .concat(
      `${x(profitArea.at(-1)?.settlement ?? xHigh)},${y(0)}`,
      `${x(profitArea[0]?.settlement ?? xLow)},${y(0)}`
    )
    .join(" ");
  const ticks = Array.from(
    { length: X_TICKS },
    (_, index) => xLow + ((xHigh - xLow) * (index + 0.5)) / X_TICKS
  );
  const hoverPnl = hover === null ? null : optionPnlAt(row, hover, size, cost);

  function track(event: React.PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setHover(xLow + share * (xHigh - xLow));
  }

  const labelClass = "fill-panel-text-muted text-[10px] tabular-nums";
  const yLabels = [yHigh, 0, yLow].filter((value, index, all) => all.indexOf(value) === index);
  return (
    <div className="relative">
      <svg
        aria-label={`Profit and loss at expiry, from ${formatPayoffUsd(yLow)} to ${formatPayoffUsd(yHigh)}, by settlement price`}
        className="block w-full"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        {yLabels.map((value) => (
          <g key={value}>
            <line
              className={value === 0 ? "stroke-panel-text-muted" : "stroke-panel-border"}
              strokeWidth={1}
              x1={PLOT.left}
              x2={PLOT.right}
              y1={y(value)}
              y2={y(value)}
            />
            <text className={labelClass} textAnchor="end" x={PLOT.left - 4} y={y(value) + 3}>
              {formatPayoffUsd(value)}
            </text>
          </g>
        ))}
        {ticks.map((tick) => (
          <text className={labelClass} key={tick} textAnchor="middle" x={x(tick)} y={HEIGHT - 6}>
            {tick.toFixed(5)}
          </text>
        ))}
        <polygon fill="var(--bid-depth)" points={area} />
        <polyline
          fill="none"
          points={lossLine}
          stroke="var(--sell)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
        />
        <polyline
          fill="none"
          points={profitLine}
          stroke="var(--buy)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
        />
        {forward === null || hover !== null ? null : (
          <line
            className="stroke-panel-text-muted"
            strokeDasharray="3 3"
            x1={x(forward)}
            x2={x(forward)}
            y1={PLOT.top}
            y2={PLOT.bottom}
          />
        )}
        {hover === null || hoverPnl === null ? null : (
          <>
            <line
              className="stroke-panel-text-muted"
              x1={x(hover)}
              x2={x(hover)}
              y1={PLOT.top}
              y2={PLOT.bottom}
            />
            <circle
              className="fill-panel-text-active stroke-panel-bg-muted"
              cx={x(hover)}
              cy={y(hoverPnl)}
              r={4}
              strokeWidth={2}
            />
          </>
        )}
        <rect
          fill="transparent"
          height={PLOT.bottom - PLOT.top}
          onPointerLeave={() => setHover(null)}
          onPointerMove={track}
          width={PLOT.right - PLOT.left}
          x={PLOT.left}
          y={PLOT.top}
        />
      </svg>
      <div className="pointer-events-none flex h-4 items-center justify-center text-[11px] text-panel-text-muted tabular-nums">
        {hover === null || hoverPnl === null
          ? restingCaption(forward)
          : `At ${formatPremium(hover)}: ${formatPayoffUsd(hoverPnl)}`}
      </div>
    </div>
  );
}

/**
 * What the order on the ticket makes or loses at expiry, by settlement price. Without a size it shows one venue unit,
 * so the shape is there before anything is typed. A sell only closes, so it has no payoff of its own.
 */
export function OptionPayoffPanel({
  cost,
  forward,
  isSell,
  payoff,
  sizeLabel,
  size,
  strike,
  type,
}: {
  cost: number | null;
  forward: number | null;
  isSell: boolean;
  payoff: OptionPayoff | null;
  size: number | null;
  sizeLabel: string | null;
  strike: number;
  type: "call" | "put";
}) {
  const ready = !isSell && payoff !== null && cost !== null && size !== null;
  return (
    <section className="flex flex-col bg-panel-bg-muted ring-1 ring-panel-ring">
      <PanelTitle>Payoff at expiry</PanelTitle>
      {ready ? (
        <div className="space-y-1 px-3 py-2">
          <div className="grid grid-cols-3 gap-2">
            <Stat
              align="text-left"
              label="Max loss"
              tone="text-ask-text"
              value={formatPayoffUsd(payoff.maxLoss)}
            />
            <Stat align="text-center" label="Break even" value={formatPremium(payoff.breakeven)} />
            <Stat
              align="text-right"
              label="Max profit"
              tone="text-bid-text"
              value={payoff.maxProfit === null ? "Unlimited" : formatPayoffUsd(payoff.maxProfit)}
            />
          </div>
          <PayoffChart
            cost={cost}
            forward={forward}
            payoff={payoff}
            size={size}
            strike={strike}
            type={type}
          />
          {sizeLabel === null ? null : (
            <p className="text-center text-[11px] text-panel-text-muted">{sizeLabel}</p>
          )}
        </div>
      ) : (
        <p className="p-3 text-[12px] text-panel-text-muted leading-snug">
          {isSell
            ? "Selling closes what you hold: you keep the proceeds, and it has no payoff at expiry."
            : "Enter a price to see the payoff."}
        </p>
      )}
    </section>
  );
}
