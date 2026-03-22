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
    <div className="relative grid grid-cols-3 px-3.5 py-0.5 text-[10px]">
      <div
        className={cn(
          "absolute inset-y-0 right-0 rounded-l-xl",
          side === "ask" ? "bg-[#5A2628]/38" : "bg-[#17382A]/38",
        )}
        style={{ width }}
      />
      <span
        className={cn(
          "relative z-10 font-semibold",
          side === "ask" ? "text-[#D7A8A8]" : "text-[#9CC7A9]",
        )}
      >
        {formatPrice(level.price)}
      </span>
      <span className="relative z-10 text-right font-medium text-[#C2CCD9]">{formatSize(level.size)}</span>
      <span className="relative z-10 text-right text-[#788699]">{formatSize(level.total)}</span>
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
    <section className="flex h-full min-h-[320px] flex-col overflow-hidden rounded-[22px] bg-[#0B121B]/76 ring-1 ring-white/5 xl:min-h-0">
      <div className="flex items-center justify-between border-white/6 border-b px-3.5 py-2.5">
        <div className="flex items-center gap-2 font-medium text-xs">
          <button
            className={cn(
              "rounded-xl px-2.5 py-1.5",
              view === "Order Book" ? "bg-white/6 text-[#E7EDF6]" : "text-[#728095]",
            )}
            onClick={() => onViewChange("Order Book")}
            type="button"
          >
            Order Book
          </button>
          <button
            className={cn(
              "rounded-xl px-2.5 py-1.5",
              view === "Trades" ? "bg-white/6 text-[#E7EDF6]" : "text-[#728095]",
            )}
            onClick={() => onViewChange("Trades")}
            type="button"
          >
            Trades
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button className="rounded-xl p-1.5 text-[#728095] transition-colors hover:bg-white/5 hover:text-[#D7DEE8]" type="button">
            <MoreHorizontal className="size-4" />
          </button>
          <button className="rounded-xl bg-white/5 px-2.5 py-1.5 text-[#C3CFDD] text-[11px]" type="button">
            {contractLabel}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 border-white/6 border-b px-3.5 py-2 text-[#5E6B7F] text-[9px] uppercase tracking-[0.16em]">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      {view === "Order Book" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="px-3.5 py-1.5 text-[#B78787] text-[9px] uppercase tracking-[0.16em]">
            Asks
          </div>
          <div className="overflow-hidden">
            {asks.map((level) => (
              <OrderRow key={level.price} level={level} maxTotal={askMax} side="ask" />
            ))}
          </div>

          <div className="mx-2.5 my-2 rounded-2xl bg-white/[0.03] px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium text-[#5E6B7F] text-[9px] uppercase tracking-[0.16em]">Spread</div>
                <div className="mt-1 font-semibold text-[#E7EDF6] text-[15px]">
                  {spread === null ? "—" : formatPrice(spread)} cNGN
                </div>
              </div>
              <div className="text-center">
                <div className="font-medium text-[#5E6B7F] text-[9px] uppercase tracking-[0.16em]">Mid Price</div>
                <div className="mt-1 font-semibold text-[#DCE9FF] text-[18px]">
                  {midPrice === null ? "—" : formatPrice(midPrice)}
                </div>
                <div className="text-[#7BA7F4] text-[9px]">
                  {spreadPercent === null ? "—" : `${spreadPercent.toFixed(3)}%`}
                </div>
              </div>
            </div>
          </div>

          <div className="px-3.5 py-1.5 text-[#7DA189] text-[9px] uppercase tracking-[0.16em]">
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
            <div className="grid grid-cols-3 px-3.5 py-1 text-[10px]" key={`${trade.time}-${trade.price}`}>
              <span className={cn("font-semibold", trade.side === "buy" ? "text-[#86AE95]" : "text-[#C48F8F]")}>
                {formatPrice(trade.price)}
              </span>
              <span className="text-right text-[#BCC7D3]">{formatSize(trade.size)}</span>
              <span className="text-right text-[#6F7C90]">{trade.time}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
