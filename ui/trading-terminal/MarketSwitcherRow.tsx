"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatFxDisplayPair, getInstrumentDetailDisplay } from "@/lib/market-display";
import { formatAnnualizedBasis, formatBasis, formatMarketPrice } from "@/lib/market-formatting";
import type { MarketDefinition } from "@/lib/trading.types";
import { SmartImage } from "@/ui/SmartImage";

function getSecondaryMetricValue({
  atmIv,
  basis,
  spotChange,
  type,
}: {
  atmIv: string | null;
  basis: number | null;
  spotChange: string | null;
  type: MarketDefinition["type"];
}) {
  if (type === "spot") {
    return spotChange ?? "—";
  }

  if (type === "future") {
    return formatBasis(basis);
  }

  return atmIv ?? "—";
}

function getTertiaryMetricValue({
  annualizedBasis,
  openInterest,
  type,
}: {
  annualizedBasis: number | null;
  openInterest: string | null;
  type: MarketDefinition["type"];
}) {
  if (type === "spot") {
    return "—";
  }

  if (type === "future") {
    return formatAnnualizedBasis(annualizedBasis);
  }

  return openInterest ?? "—";
}

export function MarketSwitcherRow({
  atmIv,
  annualizedBasis,
  basis,
  isActive,
  isFavorite,
  isSelected,
  last,
  market,
  openInterest,
  onHover,
  onSelect,
  onToggleFavorite,
  spotChange,
}: {
  atmIv: string | null;
  annualizedBasis: number | null;
  basis: number | null;
  isActive: boolean;
  isFavorite: boolean;
  isSelected: boolean;
  last: number | null;
  market: MarketDefinition;
  openInterest: string | null;
  onHover: () => void;
  onSelect: () => void;
  onToggleFavorite: () => void;
  spotChange: string | null;
}) {
  const secondaryMetricValue = getSecondaryMetricValue({
    atmIv,
    basis,
    spotChange,
    type: market.type,
  });
  const tertiaryMetricValue = getTertiaryMetricValue({
    annualizedBasis,
    openInterest,
    type: market.type,
  });
  const instrumentDetail = getInstrumentDetailDisplay(market);
  let metricItems: { label: string; value: string }[] = [
    { label: "ATM IV", value: secondaryMetricValue },
    { label: "OI", value: tertiaryMetricValue },
  ];

  if (market.type === "spot") {
    metricItems = [
      { label: "Last", value: formatMarketPrice(last) },
      { label: "24h %", value: secondaryMetricValue },
    ];
  } else if (market.type === "future") {
    metricItems = [
      { label: "Last", value: formatMarketPrice(last) },
      { label: "Basis", value: secondaryMetricValue },
      { label: "Basis %", value: tertiaryMetricValue },
    ];
  }

  return (
    <div
      data-market-row={market.id}
      className={cn(
        "flex w-full items-center gap-4 rounded-xl border border-transparent px-4 py-3 text-left transition-colors hover:border-[#223244] hover:bg-[#121A24]/72",
        isActive && "border-[#2A3B51] bg-[#101923]",
        isSelected && "border-[#31538B] bg-[#16233A] shadow-[inset_0_0_0_1px_rgba(96,165,250,0.14)]",
      )}
    >
      <button
        aria-pressed={isSelected}
        className="flex min-w-0 flex-1 items-center gap-4"
        onFocus={onHover}
        onClick={onSelect}
        onMouseEnter={onHover}
        type="button"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <SmartImage<string>
            alt={`${market.pair} flag`}
            className="h-6 w-9 shrink-0 overflow-hidden rounded-[4px] border border-[#1B2430]"
            imgClassName="object-cover"
            src={market.flagSrc}
          />
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-x-3">
              <span className="truncate font-semibold text-[#F3F4F6] text-[15px] leading-tight">
                {formatFxDisplayPair(market.pair)}
              </span>
              <span className="truncate font-medium text-[#8F98A8] text-[14px] leading-tight">
                {instrumentDetail}
              </span>
            </div>
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          {metricItems.map((item) => (
            <div
              className="rounded-full border border-[#243041] bg-[#111922] px-3 py-1.5"
              key={item.label}
            >
              <div className="text-[#6B7280] text-[10px] uppercase tracking-[0.12em]">{item.label}</div>
              <div
                className={cn(
                  "mt-0.5 text-right font-medium text-[13px]",
                  item.label === "Basis" && "text-[#93C5FD]",
                  item.label === "Basis %" && "text-[#BFDBFE]",
                  item.label === "ATM IV" && "text-[#FCD34D]",
                  item.label === "OI" && "text-[#FDE68A]",
                  item.label === "24h %" && "text-[#D1D5DB]",
                  item.label === "Last" && "text-[#D1D5DB]",
                )}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </button>

      <button
        aria-label={isFavorite ? "Remove favorite" : "Add favorite"}
        className={cn(
          "rounded-full border p-2 transition-colors",
          isFavorite
            ? "border-[#4F3E12] bg-[#241B0F] text-[#F5C451] hover:border-[#66501A] hover:text-[#F8D56B]"
            : "border-transparent bg-transparent text-[#556070] hover:border-[#1B2430] hover:bg-[#111922] hover:text-[#D1D5DB]",
        )}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite();
        }}
        onMouseEnter={onHover}
        type="button"
      >
        <Star className={cn("size-4", isFavorite && "fill-current")} />
      </button>
    </div>
  );
}
