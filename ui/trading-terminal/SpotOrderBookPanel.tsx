"use client";

import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/market-formatting";
import type { OrderBookLevel, TradePrint } from "@/lib/trading.types";

export type SpotBookTab = "book" | "trades";

function formatSize(value: number) {
  // Spot sizes are USDC notional: whole units render clean, and a real sub-unit fill keeps its
  // decimals instead of being displayed as "0".
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
}

function BookLevelRow({
  level,
  maxTotal,
  side,
}: {
  level: OrderBookLevel;
  maxTotal: number;
  side: "ask" | "bid";
}) {
  const width = `${(level.total / maxTotal) * 100}%`;

  return (
    <div className="relative grid grid-cols-3 px-3 py-0.5 text-[10px]">
      <div
        className={cn(
          "absolute inset-y-0 right-0 rounded-l-lg",
          side === "ask" ? "bg-ask-bg" : "bg-bid-bg"
        )}
        style={{ width }}
      />
      <span
        className={cn(
          "relative z-10 font-semibold",
          side === "ask" ? "text-ask-text" : "text-bid-text"
        )}
      >
        {formatNaira(level.price)}
      </span>
      <span className="relative z-10 text-right font-medium text-panel-text">
        {formatSize(level.size)}
      </span>
      <span className="relative z-10 text-right text-panel-text-muted">
        {formatSize(level.total)}
      </span>
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
}: {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  lastPrice: number | null;
}) {
  const askMax = Math.max(...asks.map((level) => level.total), 1);
  const bidMax = Math.max(...bids.map((level) => level.total), 1);
  const bestAsk = asks[0]?.price ?? null;
  const bestBid = bids[0]?.price ?? null;
  const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;
  const midPrice = bestAsk !== null && bestBid !== null ? (bestAsk + bestBid) / 2 : null;
  const spreadPercent = midPrice !== null && spread !== null ? (spread / midPrice) * 100 : null;
  // Coinbase-style ladder: best ask sits directly above the spread row.
  const descendingAsks = [...asks].reverse();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
        {asks.length === 0 ? (
          <BookEmptyState message="No resting asks" />
        ) : (
          descendingAsks.map((level) => (
            <BookLevelRow key={level.price} level={level} maxTotal={askMax} side="ask" />
          ))
        )}
      </div>

      <div className="border-panel-border border-y bg-input-bg/60 px-3 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-[13px] text-mid-price">
            {formatNaira(lastPrice ?? midPrice)}
          </span>
          <span className="text-right text-[9px] text-panel-text-muted leading-tight">
            Spread {spread === null ? "—" : formatNaira(spread)}
            <span className="ml-1 text-spread-percent">
              {spreadPercent === null ? "" : `(${spreadPercent.toFixed(3)}%)`}
            </span>
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {bids.length === 0 ? (
          <BookEmptyState message="No resting bids" />
        ) : (
          bids.map((level) => (
            <BookLevelRow key={level.price} level={level} maxTotal={bidMax} side="bid" />
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
          className="grid grid-cols-3 px-3 py-1 text-[10px]"
          key={`${trade.time}-${trade.price}-${trade.size}`}
        >
          <span
            className={cn(
              "font-semibold",
              trade.side === "buy" ? "text-bid-text" : "text-ask-text"
            )}
          >
            {formatNaira(trade.price)}
          </span>
          <span className="text-right text-panel-text">{formatSize(trade.size)}</span>
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
  return (
    <section className="flex h-full min-h-[380px] flex-col overflow-hidden rounded-[20px] bg-panel-bg-muted ring-1 ring-panel-ring transition-colors duration-300 xl:min-h-0">
      <div className="flex items-center gap-1.5 border-panel-border border-b px-3 py-2 font-medium text-[11px]">
        <button
          className={cn(
            "cursor-pointer rounded-xl px-2 py-1 transition-colors",
            tab === "book"
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
            "cursor-pointer rounded-xl px-2 py-1 transition-colors",
            tab === "trades"
              ? "bg-input-bg text-panel-text-active"
              : "text-panel-text-muted hover:text-panel-text"
          )}
          onClick={() => onTabChange("trades")}
          type="button"
        >
          Recent trades
        </button>
      </div>

      <div className="grid grid-cols-3 border-panel-border border-b px-3 py-1.5 text-[8px] text-panel-text-muted uppercase tracking-[0.16em]">
        <span>Price (₦)</span>
        <span className="text-right">Size (USDC)</span>
        <span className="text-right">{tab === "book" ? "Total" : "Time"}</span>
      </div>

      {tab === "book" ? (
        <BookLadder asks={asks} bids={bids} lastPrice={lastPrice} />
      ) : (
        <TradeTape trades={trades} />
      )}
    </section>
  );
}
