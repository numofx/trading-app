import { MoreHorizontal } from "lucide-react";
import { ORDER_BOOK_ASKS, ORDER_BOOK_BIDS } from "@/lib/mock-trading-data";
import type { OrderBookLevel } from "@/lib/trading.types";
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
    <div className="relative grid grid-cols-3 px-3 py-1.5 text-xs">
      <div
        className={cn(
          "absolute inset-y-0 right-0 rounded-sm",
          side === "ask" ? "bg-[#7f1d1d]/28" : "bg-[#14532d]/28",
        )}
        style={{ width }}
      />
      <span
        className={cn(
          "relative z-10 font-medium",
          side === "ask" ? "text-[#F87171]" : "text-[#4ADE80]",
        )}
      >
        {formatPrice(level.price)}
      </span>
      <span className="relative z-10 text-right text-[#D1D5DB]">{formatSize(level.size)}</span>
      <span className="relative z-10 text-right text-[#9CA3AF]">{formatSize(level.total)}</span>
    </div>
  );
}

export function OrderBook() {
  const askMax = Math.max(...ORDER_BOOK_ASKS.map((level) => level.total));
  const bidMax = Math.max(...ORDER_BOOK_BIDS.map((level) => level.total));

  return (
    <section className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-md border border-[#1B2430] bg-[#11161D] xl:min-h-0">
      <div className="flex items-center justify-between border-[#1B2430] border-b px-3 py-1.5">
        <div className="flex items-center gap-2 font-medium text-xs">
          <button className="rounded-sm bg-[#151B23] px-2.5 py-1 text-[#E5E7EB]" type="button">
            Order Book
          </button>
          <button className="rounded-sm px-2.5 py-1 text-[#6B7280] hover:bg-[#151B23]" type="button">
            Trades
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button className="rounded-sm p-1.5 text-[#6B7280] hover:bg-[#151B23]" type="button">
            <MoreHorizontal className="size-4" />
          </button>
          <button className="rounded-sm border border-[#1B2430] bg-[#151B23] px-2.5 py-1 text-[#D1D5DB] text-xs" type="button">
            JUN 26
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 border-[#1B2430] border-b px-3 py-1.5 text-[#6B7280] text-[10px] uppercase tracking-[0.14em]">
        <span>Price (NGN)</span>
        <span className="text-right">Size (USD)</span>
        <span className="text-right">Total (USD)</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="overflow-hidden">
          {ORDER_BOOK_ASKS.map((level) => (
            <OrderRow key={level.price} level={level} maxTotal={askMax} side="ask" />
          ))}
        </div>

        <div className="border-[#1B2430] border-y bg-[#151B23] px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[#6B7280] text-[11px]">Spread</span>
            <div className="flex items-center gap-2 text-xs">
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
