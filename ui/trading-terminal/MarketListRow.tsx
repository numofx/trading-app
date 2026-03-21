"use client";

import { cn } from "@/lib/cn";
import { formatAnnualizedBasis, formatBasis, formatMarketPrice } from "@/lib/market-formatting";
import type { MarketDefinition } from "@/lib/trading.types";
import { SmartImage } from "@/ui/SmartImage";
import { TypeBadge } from "@/ui/trading-terminal/TypeBadge";

export function MarketListRow({
  annualizedBasis,
  basis,
  isSelected,
  last,
  market,
  onSelect,
}: {
  annualizedBasis: number | null;
  basis: number | null;
  isSelected: boolean;
  last: number | null;
  market: MarketDefinition;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        "grid w-full grid-cols-[minmax(260px,2.6fr)_92px_92px_92px_84px] items-center gap-4 border-[#1B2430] border-b px-4 py-3 text-left transition-colors hover:bg-[#151B23]/55",
        isSelected && "border-l-2 border-l-[#60A5FA] bg-[#172554]/35 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.18)]",
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex min-w-0 items-center gap-3">
        <SmartImage<string>
          alt={`${market.pair} flag`}
          className="h-5 w-8 shrink-0 overflow-hidden rounded-[2px] border border-[#1B2430]"
          imgClassName="object-cover"
          src={market.flagSrc}
        />
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-[#E5E7EB] text-[15px] leading-tight">
            {market.pair}
          </span>
          <TypeBadge type={market.type} />
          {market.expiryLabel ? (
            <span className="shrink-0 text-[#9CA3AF] text-[13px]">{market.expiryLabel}</span>
          ) : null}
        </div>
      </div>

      <span className="text-right font-semibold text-[#D1D5DB] text-[13px]">
        {formatMarketPrice(last)}
      </span>

      <span
        className={cn(
          "text-right font-medium text-[13px]",
          market.type !== "spot" && "text-[#93C5FD]",
          market.type === "spot" && "text-[#6B7280]",
        )}
      >
        {formatBasis(basis)}
      </span>

      <span
        className={cn(
          "text-right font-medium text-[13px]",
          market.type !== "spot" && "text-[#BFDBFE]",
          market.type === "spot" && "text-[#6B7280]",
        )}
      >
        {formatAnnualizedBasis(annualizedBasis)}
      </span>

      <span
        className={cn(
          "text-right font-medium text-[13px]",
          isSelected ? "text-[#E5E7EB]" : "text-[#9CA3AF]",
        )}
      >
        {market.expiryLabel ?? "—"}
      </span>
    </button>
  );
}
