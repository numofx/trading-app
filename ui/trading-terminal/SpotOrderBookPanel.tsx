"use client";

import { Menu } from "@base-ui/react/menu";
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronDown, ExternalLink } from "lucide-react";
import { useState } from "react";
import { getAppChain } from "@/lib/base-public-client";
import { cn } from "@/lib/cn";
import { getExplorerTransactionUrl } from "@/lib/explorer-links";
import { formatTradeStamp } from "@/lib/live-market";
import { formatMarketPrice, formatNaira } from "@/lib/market-formatting";
import type { LadderRow, LadderUnit } from "@/lib/order-book-display";
import {
  buildEmptyRungs,
  buildLadderRows,
  formatLadderAmount,
  getMaxLadderTotal,
  getSpreadBps,
  PRICE_GROUPS,
} from "@/lib/order-book-display";
import { getAnchorPrice, getBestPrices } from "@/lib/spot-market";
import type { OrderBookLevel, TradePrint } from "@/lib/trading.types";
import { PanelTabs } from "@/ui/trading-terminal/PanelTabs";

export type SpotBookTab = "book" | "trades";

/** What each ladder unit is called on screen. Base is the USDC notional an order is entered in. */
const UNIT_LABEL = { base: "USDC", quote: "cNGN" } satisfies Record<LadderUnit, string>;

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
        className="flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-1 font-medium text-[12px] text-panel-text-active transition-colors hover:bg-input-hover"
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
    <div className="relative mx-2 my-px grid grid-cols-3 rounded-sm px-2 py-1 text-[12px] tabular-nums transition-colors hover:bg-input-hover">
      {/* The bar grows from the price edge, as a rounded block the price sits inside of. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 rounded-sm",
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
      <span className="relative z-10 text-right text-panel-text-active">
        {formatLadderAmount(row.amount)}
      </span>
      <span className="relative z-10 text-right text-panel-text-active">
        {formatLadderAmount(row.total)}
      </span>
    </div>
  );
}

/**
 * A price bucket with nothing resting in it, continuing the ladder past the last real level. Muted,
 * no bar, no size: it is the grid, not depth.
 */
function BookEmptyRungRow({ digits, price }: { digits: number; price: number }) {
  return (
    <div className="mx-2 my-px grid grid-cols-3 px-2 py-1 text-[12px] text-panel-text-muted/50 tabular-nums">
      <span>{formatMarketPrice(price, digits)}</span>
      <span className="text-right">—</span>
      <span className="text-right">—</span>
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
  // A thin book (the perp maker rests three levels a side) keeps a full-height grid: empty buckets
  // one tick apart continue each side past its last level, without claiming any depth.
  const askRungs = buildEmptyRungs({ rows: askRows, side: "ask", tick });
  const bidRungs = buildEmptyRungs({ rows: bidRows, side: "bid", tick });
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
  // Coinbase-style ladder: best ask sits directly above the spread row. The asks render in
  // ascending order into a `flex-col-reverse` container, which paints them bottom-up — so the
  // best ask lands against the spread without reversing the array.

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/*
       * `flex-col-reverse` rather than `justify-end`, and `auto` rather than `hidden`.
       *
       * The panel is shorter than the book on most screens — 84% of desktop sessions are under
       * 1000px tall — and with `overflow-hidden` the rungs past the fold were not merely
       * offscreen, they were unreachable and unannounced: at 1280x577 an 8-rung side showed 4,
       * with no scrollbar and nothing to say the rest existed. A book that hides half its depth
       * misreports the market.
       *
       * `justify-end` cannot simply become `overflow-y-auto`: content overflowing a
       * `justify-content: flex-end` container is clipped at the start edge and cannot be
       * scrolled to. Column-reverse puts the scroll origin at the visual bottom instead, so the
       * touch stays pinned against the spread, depth grows upward without shifting the view, and
       * a reader who scrolls out to the far side stays there across the 2s book updates. An
       * effect that re-anchored scrollTop on every render would fight them for the scrollbar.
       */}
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
        {askRows.length === 0 ? (
          <BookEmptyState message="No resting asks" />
        ) : (
          <>
            {askRows.map((row) => (
              <BookLevelRow
                digits={digits}
                key={row.price}
                maxTotal={maxTotal}
                row={row}
                side="ask"
              />
            ))}
            {askRungs.map((price) => (
              <BookEmptyRungRow digits={digits} key={`empty-${price}`} price={price} />
            ))}
          </>
        )}
      </div>

      {/*
       * The number is the book's anchor — the mid of the two touches, falling back to the single
       * resting side and only then to the last trade. The arrow beside it is the last trade's
       * direction, which is the one thing here that says which way the market last moved.
       */}
      <div className="mx-2 my-1 grid grid-cols-3 items-center rounded-sm bg-input-bg px-2 py-1.5 text-[12px] tabular-nums">
        <span
          className={cn(
            "flex items-center gap-1 font-semibold",
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
        <span className="text-center font-medium text-panel-text">
          Spread{spread === null ? "" : ` ${formatNaira(spread)}`}
        </span>
        <span className="text-right text-spread-percent">
          {spreadBps === null ? "—" : `${(spreadBps / 100).toFixed(3)}%`}
        </span>
      </div>

      {/* Bids already grow downward from the touch, so plain `auto` is enough: the scroll origin
       * is the top, which is where the best bid sits. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {bidRows.length === 0 ? (
          <BookEmptyState message="No resting bids" />
        ) : (
          <>
            {bidRows.map((row) => (
              <BookLevelRow
                digits={digits}
                key={row.price}
                maxTotal={maxTotal}
                row={row}
                side="bid"
              />
            ))}
            {bidRungs.map((price) => (
              <BookEmptyRungRow digits={digits} key={`empty-${price}`} price={price} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The tape's columns: the time is a fixed width wide enough for a date, a time with seconds and the
 * explorer icon, so the size beside it never runs into it; price and size share the rest.
 */
const TAPE_COLUMNS = "grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_7.5rem]";

/**
 * When a fill happened, in the viewer's zone, with its date when it is not from today: the tape
 * spans days on a quiet market, and times alone read out of order across midnight. Formatted on
 * the client, so the server's UTC rendering is replaced on hydration rather than compared.
 */
function TradeStamp({ trade }: { trade: TradePrint }) {
  if (trade.atMs === undefined) {
    return <span className="text-right text-panel-text">{trade.time}</span>;
  }
  const stamp = formatTradeStamp(trade.atMs, {
    nowMs: Date.now(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return (
    <span className="whitespace-nowrap text-right text-panel-text" suppressHydrationWarning>
      {stamp.date === null ? null : (
        <span className="mr-1.5 text-panel-text-muted">{stamp.date}</span>
      )}
      {stamp.time}
    </span>
  );
}

/**
 * A link to the fill's settling transaction on the explorer, when the venue recorded the hash.
 * Fills from before the venue stored it, and a streamed fill from a venue not yet serving it,
 * have no icon rather than a dead one.
 */
function TradeExplorerLink({ txHash }: { txHash: string | undefined }) {
  const href = getExplorerTransactionUrl(txHash, getAppChain().blockExplorers?.default.url);
  if (href === null) {
    return null;
  }
  return (
    <a
      aria-label="View transaction on Basescan"
      className="inline-flex shrink-0 text-panel-text-muted transition-colors hover:text-panel-text-active"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      title="View on Basescan"
    >
      <ExternalLink aria-hidden className="size-3" />
    </a>
  );
}

/**
 * The venue's fills, newest first: each row tinted by the side that took it, the price in that
 * side's colour, the size, when it happened, and a link to the settling transaction.
 */
function TradeTape({ trades }: { trades: TradePrint[] }) {
  if (trades.length === 0) {
    return <BookEmptyState message="No trades yet" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 py-1">
      {trades.map((trade) => (
        <div
          className={cn(
            "grid rounded-sm px-2 py-1 text-[12px] tabular-nums transition-colors",
            TAPE_COLUMNS,
            // Hover deepens the side's tint rather than replacing it with the neutral one.
            trade.side === "buy" ? "bg-bid-bg hover:bg-bid-depth" : "bg-ask-bg hover:bg-ask-depth"
          )}
          key={`${trade.id ?? trade.time}-${trade.price}-${trade.size}`}
        >
          <span
            className={cn("font-medium", trade.side === "buy" ? "text-bid-text" : "text-ask-text")}
          >
            {formatMarketPrice(trade.price, 2)}
          </span>
          <span className="text-right text-panel-text">{formatLadderAmount(trade.size)}</span>
          <span className="flex items-center justify-end gap-1.5">
            <TradeStamp trade={trade} />
            <TradeExplorerLink txHash={trade.txHash} />
          </span>
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
    <section className="flex h-full min-h-[380px] flex-col overflow-hidden bg-panel-bg-muted ring-1 ring-panel-ring transition-colors duration-300 md:min-h-0">
      <PanelTabs
        fill
        onSelect={onTabChange}
        selected={tab}
        tabs={[
          { id: "book", label: "Order book" },
          { id: "trades", label: "Trades" },
        ]}
      />

      {isBook ? (
        <div className="flex items-center justify-between px-2 pt-2 pb-1">
          <LadderSelect
            label="Price grouping"
            onSelect={(value) => setTick(Number(value))}
            options={PRICE_GROUPS.map((group) => ({ label: String(group), value: String(group) }))}
            value={String(tick)}
          />
          {/* The unit is a two-way swap, so a single button flips it rather than opening a menu. */}
          <button
            aria-label={`Amount denomination: ${UNIT_LABEL[unit]}. Switch to ${unit === "base" ? UNIT_LABEL.quote : UNIT_LABEL.base}`}
            className="flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-1 font-medium text-[12px] text-panel-text-active transition-colors hover:bg-input-hover"
            onClick={() => setUnit((current) => (current === "base" ? "quote" : "base"))}
            type="button"
          >
            {UNIT_LABEL[unit]}
            <ArrowLeftRight aria-hidden className="size-3.5 text-panel-text-muted" />
          </button>
        </div>
      ) : null}

      <div
        className={cn(
          "grid whitespace-nowrap px-4 pt-1 pb-1.5 text-[11px] text-panel-text-muted",
          isBook ? "grid-cols-3" : TAPE_COLUMNS
        )}
      >
        <span>Price cNGN</span>
        <span className="text-right">{isBook ? `Size ${UNIT_LABEL[unit]}` : "Size USDC"}</span>
        <span className="text-right">{isBook ? `Total ${UNIT_LABEL[unit]}` : "Time"}</span>
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
