import { MoreHorizontal } from "lucide-react";
import type { OrderBookLevel, TradePrint } from "@/lib/trading.types";
import { cn } from "@/lib/cn";

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
}

function formatSize(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function OrderRow({
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
    <div className="relative grid grid-cols-3 px-3 py-0.5 text-[9px]">
      <div
        className={cn(
          "absolute inset-y-0 right-0 rounded-l-xl",
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
        {formatPrice(level.price)}
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

export function OrderBookPanel({
  asks,
  bids,
  contractLabel,
  trades,
  view,
  onViewChange,
}: {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  contractLabel: string;
  trades: TradePrint[];
  view: "Order Book" | "Trades";
  onViewChange: (view: "Order Book" | "Trades") => void;
}) {
  const askMax = Math.max(...asks.map((level) => level.total));
  const bidMax = Math.max(...bids.map((level) => level.total));
  const bestAsk = asks[0]?.price ?? null;
  const bestBid = bids[0]?.price ?? null;
  const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;
  const midPrice = bestAsk !== null && bestBid !== null ? (bestAsk + bestBid) / 2 : null;
  const spreadPercent = midPrice && spread !== null ? (spread / midPrice) * 100 : null;

  return (
    <section className="flex h-full min-h-[300px] flex-col overflow-hidden rounded-[20px] bg-panel-bg-muted ring-1 ring-panel-ring transition-colors duration-300 xl:min-h-0">
      <div className="flex items-center justify-between border-panel-border border-b px-3 py-2">
        <div className="flex items-center gap-1.5 font-medium text-[11px]">
          <button
            className={cn(
              "rounded-xl px-2 py-1",
              view === "Order Book" ? "bg-input-bg text-panel-text-active" : "text-panel-text-muted"
            )}
            onClick={() => onViewChange("Order Book")}
            type="button"
          >
            Order Book
          </button>
          <button
            className={cn(
              "rounded-xl px-2 py-1",
              view === "Trades" ? "bg-input-bg text-panel-text-active" : "text-panel-text-muted"
            )}
            onClick={() => onViewChange("Trades")}
            type="button"
          >
            Trades
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            className="rounded-xl p-1 text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text-active"
            type="button"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
          <button
            className="rounded-xl bg-input-bg px-2 py-1 text-[10px] text-panel-text"
            type="button"
          >
            {contractLabel}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 border-panel-border border-b px-3 py-1.5 text-[8px] text-panel-text-muted uppercase tracking-[0.16em]">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      {view === "Order Book" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="px-3 py-1 text-[8px] text-ask-label uppercase tracking-[0.16em]">
            Asks
          </div>
          <div className="overflow-hidden">
            {asks.map((level) => (
              <OrderRow key={level.price} level={level} maxTotal={askMax} side="ask" />
            ))}
          </div>

          <div className="mx-2 my-1.5 rounded-2xl bg-input-bg px-3 py-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium text-[8px] text-panel-text-muted uppercase tracking-[0.16em]">
                  Spread
                </div>
                <div className="mt-1 font-semibold text-[13px] text-panel-text-active">
                  {spread === null ? "—" : formatPrice(spread)} cNGN
                </div>
              </div>
              <div className="text-center">
                <div className="font-medium text-[8px] text-panel-text-muted uppercase tracking-[0.16em]">
                  Mid Price
                </div>
                <div className="mt-1 font-semibold text-[15px] text-mid-price">
                  {midPrice === null ? "—" : formatPrice(midPrice)}
                </div>
                <div className="text-[8px] text-spread-percent">
                  {spreadPercent === null ? "—" : `${spreadPercent.toFixed(3)}%`}
                </div>
              </div>
            </div>
          </div>

          <div className="px-3 py-1 text-[8px] text-bid-label uppercase tracking-[0.16em]">
            Bids
          </div>
          <div className="overflow-hidden">
            {bids.map((level) => (
              <OrderRow key={level.price} level={level} maxTotal={bidMax} side="bid" />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {trades.map((trade) => (
            <div
              className="grid grid-cols-3 px-3 py-1 text-[9px]"
              key={`${trade.time}-${trade.price}`}
            >
              <span
                className={cn(
                  "font-semibold",
                  trade.side === "buy" ? "text-bid-text" : "text-ask-text"
                )}
              >
                {formatPrice(trade.price)}
              </span>
              <span className="text-right text-panel-text">{formatSize(trade.size)}</span>
              <span className="text-right text-panel-text-muted">{trade.time}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
