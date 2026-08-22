"use client";

import { Menu } from "@base-ui/react/menu";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatMarketPrice, formatNaira } from "@/lib/market-formatting";
import type { LadderRow, LadderUnit } from "@/lib/order-book-display";
import {
  buildLadderRows,
  getMaxLadderTotal,
  getSpreadBps,
  PRICE_GROUPS,
} from "@/lib/order-book-display";
import { getAnchorPrice, getBestPrices } from "@/lib/spot-market";
import type { OrderBookLevel, TradePrint } from "@/lib/trading.types";

export type SpotBookTab = "book" | "trades";

/** What each ladder unit is called on screen. Base is the USDC notional an order is entered in. */
const UNIT_LABEL = { base: "USDC", quote: "cNGN" } satisfies Record<LadderUnit, string>;

const COMPACT_AMOUNT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
  notation: "compact",
});
const PLAIN_AMOUNT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/**
 * Spot sizes are USDC notional: whole units render clean, and a real sub-unit fill keeps its
 * decimals instead of being displayed as "0". Restated in cNGN they run into the millions, so
 * anything past a thousand goes compact rather than pushing the price column off its edge.
 */
function formatAmount(value: number) {
  return Math.abs(value) >= 1000 ? COMPACT_AMOUNT.format(value) : PLAIN_AMOUNT.format(value);
}

/** Prices carry exactly the precision the ladder is grouped at: a 0.1 tick has no second decimal. */
function getPriceDigits(tick: number) {
  return Math.max(0, -Math.round(Math.log10(tick)));
}

function LadderSelect({
  label,
  onSelect,
  options,
  value,
}: {
  label: string;
  onSelect: (value: string) => void;
  options: { label: string; value: string }[];
  value: string;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm border border-input-border bg-input-bg px-2 py-1.5 text-[11px] text-panel-text transition-colors hover:bg-input-hover"
      >
        <span>{options.find((option) => option.value === value)?.label}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-panel-text-muted" />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner align="start" sideOffset={6}>
          <Menu.Popup className="z-50 min-w-(--anchor-width) overflow-hidden rounded-sm border border-panel-border bg-panel-bg-darker p-1 shadow-[0_20px_60px_var(--panel-shadow)] outline-none transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
            {options.map((option) => (
              <Menu.Item
                className={cn(
                  "cursor-pointer rounded-sm px-2 py-1.5 text-[11px] outline-none transition-colors data-highlighted:bg-input-hover",
                  option.value === value ? "text-panel-text-active" : "text-panel-text-muted"
                )}
                key={option.value}
                onClick={() => onSelect(option.value)}
              >
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function BookLevelRow({
  digits,
  maxTotal,
  row,
  side,
}: {
  digits: number;
  maxTotal: number;
  row: LadderRow;
  side: "ask" | "bid";
}) {
  // The bar is cumulative depth against the deepest row in the whole book, so it reads as how far
  // through the side an order would have to sweep — and so the two sides stay comparable.
  const width = `${Math.min(100, (row.total / maxTotal) * 100)}%`;

  return (
    <div className="relative grid grid-cols-3 px-3 py-[3px] text-[11px] tabular-nums transition-colors hover:bg-input-hover">
      <div
        aria-hidden
        className={cn(
          "absolute inset-y-0 right-0",
          side === "ask" ? "bg-ask-depth" : "bg-bid-depth"
        )}
        style={{ width }}
      />
      <span
        className={cn(
          "relative z-10 font-medium",
          side === "ask" ? "text-ask-text" : "text-bid-text"
        )}
      >
        {formatMarketPrice(row.price, digits)}
      </span>
      <span className="relative z-10 text-right text-panel-text">{formatAmount(row.amount)}</span>
      <span className="relative z-10 text-right text-panel-text">{formatAmount(row.total)}</span>
    </div>
  );
}

/**
 * Shown when the venue has nothing resting or nothing traded. The panel renders only real venue
 * data, so an empty market is empty on screen rather than filled with sample depth.
 */
function BookEmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-3 py-6 text-center text-[11px] text-panel-text-muted">
      {message}
    </div>
  );
}

/** The bid/ask ladder with the spread row between the two sides. */
function BookLadder({
  asks,
  bids,
  lastPrice,
  lastSide,
  tick,
  unit,
}: {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  lastPrice: number | null;
  lastSide: "buy" | "sell" | null;
  tick: number;
  unit: LadderUnit;
}) {
  const askRows = buildLadderRows({ levels: asks, side: "ask", tick, unit });
  const bidRows = buildLadderRows({ levels: bids, side: "bid", tick, unit });
  // The spread quotes the true touch, not the grouped one: a coarse tick moves a bucket's label
  // away from the price that is actually resting, and the spread must stay the tradeable number.
  const { bestAsk, bestBid } = getBestPrices(asks, bids);
  const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;
  const spreadBps = getSpreadBps(bestAsk, bestBid);
  const anchorPrice = getAnchorPrice(bestAsk, bestBid, lastPrice);
  const digits = getPriceDigits(tick);
  // One scale for both sides: normalising each side against its own deepest row made a thin side
  // look as deep as a heavy one, which is the comparison the bars exist to make.
  const maxTotal = Math.max(getMaxLadderTotal(askRows), getMaxLadderTotal(bidRows));
  // Coinbase-style ladder: best ask sits directly above the spread row.
  const descendingAsks = [...askRows].reverse();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
        {askRows.length === 0 ? (
          <BookEmptyState message="No resting asks" />
        ) : (
          descendingAsks.map((row) => (
            <BookLevelRow
              digits={digits}
              key={row.price}
              maxTotal={maxTotal}
              row={row}
              side="ask"
            />
          ))
        )}
      </div>

      {/*
       * The number is the book's anchor — the mid of the two touches, falling back to the single
       * resting side and only then to the last trade. The arrow beside it is the last trade's
       * direction, which is the one thing here that says which way the market last moved.
       */}
      <div className="border-panel-border border-y bg-input-bg/60 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "flex items-center gap-1 font-semibold text-[15px] tabular-nums",
              lastSide === null ? "text-mid-price" : null,
              lastSide === "buy" ? "text-bid-text" : null,
              lastSide === "sell" ? "text-ask-text" : null
            )}
          >
            {formatNaira(anchorPrice)}
            {lastSide === "buy" ? (
              <ArrowUp aria-label="Last trade was a buy" className="size-3.5" />
            ) : null}
            {lastSide === "sell" ? (
              <ArrowDown aria-label="Last trade was a sell" className="size-3.5" />
            ) : null}
          </span>
          <span className="text-right text-[11px] text-panel-text-muted tabular-nums">
            Spread {spread === null ? "—" : formatNaira(spread)}
            {spreadBps === null ? null : (
              <span className="ml-1 text-spread-percent">({spreadBps.toFixed(2)} bps)</span>
            )}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {bidRows.length === 0 ? (
          <BookEmptyState message="No resting bids" />
        ) : (
          bidRows.map((row) => (
            <BookLevelRow
              digits={digits}
              key={row.price}
              maxTotal={maxTotal}
              row={row}
              side="bid"
            />
          ))
        )}
      </div>
    </div>
  );
}

/** The venue's recent fills, newest first. */
function TradeTape({ trades }: { trades: TradePrint[] }) {
  if (trades.length === 0) {
    return <BookEmptyState message="No trades yet" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {trades.map((trade) => (
        <div
          className="grid grid-cols-3 px-3 py-[3px] text-[11px] tabular-nums transition-colors hover:bg-input-hover"
          key={`${trade.time}-${trade.price}-${trade.size}`}
        >
          <span
            className={cn("font-medium", trade.side === "buy" ? "text-bid-text" : "text-ask-text")}
          >
            {formatMarketPrice(trade.price, 2)}
          </span>
          <span className="text-right text-panel-text">{formatAmount(trade.size)}</span>
          <span className="text-right text-panel-text-muted">{trade.time}</span>
        </div>
      ))}
    </div>
  );
}

export function SpotOrderBookPanel({
  asks,
  bids,
  lastPrice,
  onTabChange,
  tab,
  trades,
}: {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  lastPrice: number | null;
  onTabChange: (tab: SpotBookTab) => void;
  tab: SpotBookTab;
  trades: TradePrint[];
}) {
  // Display preferences, not market state: the ladder they shape is the same venue book either way.
  const [tick, setTick] = useState<number>(PRICE_GROUPS[0]);
  const [unit, setUnit] = useState<LadderUnit>("base");
  const isBook = tab === "book";
  const lastSide = trades[0]?.side ?? null;

  return (
    <section className="flex h-full min-h-[380px] flex-col overflow-hidden bg-panel-bg-muted ring-1 ring-panel-ring transition-colors duration-300 xl:min-h-0">
      <div className="flex items-center gap-1.5 px-3 py-2 font-medium text-[12px]">
        <button
          className={cn(
            "cursor-pointer rounded-sm px-2 py-1 transition-colors",
            isBook
              ? "bg-input-bg text-panel-text-active"
              : "text-panel-text-muted hover:text-panel-text"
          )}
          onClick={() => onTabChange("book")}
          type="button"
        >
          Order book
        </button>
        <button
          className={cn(
            "cursor-pointer rounded-sm px-2 py-1 transition-colors",
            isBook
              ? "text-panel-text-muted hover:text-panel-text"
              : "bg-input-bg text-panel-text-active"
          )}
          onClick={() => onTabChange("trades")}
          type="button"
        >
          Recent trades
        </button>
      </div>

      {isBook ? (
        <div className="grid grid-cols-2 gap-2 px-3 pb-2">
          <LadderSelect
            label="Price grouping"
            onSelect={(value) => setTick(Number(value))}
            options={PRICE_GROUPS.map((group) => ({ label: String(group), value: String(group) }))}
            value={String(tick)}
          />
          <LadderSelect
            label="Amount denomination"
            onSelect={(value) => setUnit(value as LadderUnit)}
            options={[
              { label: UNIT_LABEL.base, value: "base" },
              { label: UNIT_LABEL.quote, value: "quote" },
            ]}
            value={unit}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-3 border-panel-border border-y px-3 py-1.5 text-[10px] text-panel-text-muted">
        <span>Price (cNGN)</span>
        <span className="text-right">
          {isBook ? `Amount (${UNIT_LABEL[unit]})` : "Size (USDC)"}
        </span>
        <span className="text-right">{isBook ? `Total (${UNIT_LABEL[unit]})` : "Time"}</span>
      </div>

      {isBook ? (
        <BookLadder
          asks={asks}
          bids={bids}
          lastPrice={lastPrice}
          lastSide={lastSide}
          tick={tick}
          unit={unit}
        />
      ) : (
        <TradeTape trades={trades} />
      )}
    </section>
  );
}
