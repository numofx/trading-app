import { MoreHorizontal } from "lucide-react";
import type { OrderBookLevel } from "@/lib/trading.types";
import { cn } from "@/lib/cn";
import { ORDER_BOOK_ASKS, ORDER_BOOK_BIDS } from "@/lib/mock-trading-data";

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
    <div className="relative grid grid-cols-3 px-2.5 py-1 text-[11px]">
      <div
        className={cn(
          "absolute inset-y-0 right-0 rounded-sm",
          side === "ask" ? "bg-[#4D1717]/30" : "bg-[#123524]/30",
        )}
        style={{ width }}
      />
      <span
        className={cn(
          "relative z-10 font-semibold",
          side === "ask" ? "text-[#D59C9C]" : "text-[#8CC9A3]",
        )}
      >
        {formatPrice(level.price)}
      </span>
      <span className="relative z-10 text-right font-medium text-[#D1D5DB]">{formatSize(level.size)}</span>
      <span className="relative z-10 text-right text-[#9CA3AF]">{formatSize(level.total)}</span>
    </div>
  );
}

export function OrderBook() {
  const askMax = Math.max(...ORDER_BOOK_ASKS.map((level) => level.total));
  const bidMax = Math.max(...ORDER_BOOK_BIDS.map((level) => level.total));

  return (
    <section className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-md border border-[#1B2430] bg-[#0F1720] xl:min-h-0">
      <div className="flex items-center justify-between border-[#1B2430] border-b px-2.5 py-1">
        <div className="flex items-center gap-2 font-medium text-xs">
          <button className="rounded-sm bg-[#11161D] px-2 py-1 text-[#E5E7EB]" type="button">
            Order Book
          </button>
          <button className="rounded-sm px-2 py-1 text-[#6B7280] hover:bg-[#11161D]" type="button">
            Trades
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button className="rounded-sm p-1.5 text-[#6B7280] hover:bg-[#11161D]" type="button">
            <MoreHorizontal className="size-4" />
          </button>
          <button className="rounded-sm border border-[#1B2430] bg-[#11161D] px-2 py-1 text-[#D1D5DB] text-xs" type="button">
            JUN 26
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 border-[#1B2430] border-b px-2.5 py-1 text-[#6B7280] text-[10px] uppercase tracking-[0.14em]">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="overflow-hidden">
          {ORDER_BOOK_ASKS.map((level) => (
            <OrderRow key={level.price} level={level} maxTotal={askMax} side="ask" />
          ))}
        </div>

        <div className="border-[#1B2430] border-y bg-[#11161D] px-2.5 py-1">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[#6B7280] text-[10px] uppercase tracking-[0.14em]">Spread</span>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="font-semibold text-[#E5E7EB]">0.10</span>
              <span className="text-[#60A5FA]">0.006%</span>
            </div>
          </div>
        </div>

        <div className="overflow-hidden">
          {ORDER_BOOK_BIDS.map((level) => (
            <OrderRow key={level.price} level={level} maxTotal={bidMax} side="bid" />
          ))}
        </div>
      </div>
    </section>
  );
}
