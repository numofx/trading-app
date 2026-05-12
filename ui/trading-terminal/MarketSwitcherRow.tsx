"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatFxDisplayPair, getInstrumentDetailDisplay } from "@/lib/market-display";
import { getMarketTokenIcons } from "@/lib/market-token-icons";
import type { MarketDefinition } from "@/lib/trading.types";
import { SmartImage } from "@/ui/SmartImage";

function getInstrumentTypePillLabel(type: MarketDefinition["type"]) {
  if (type === "future") {
    return "Future";
  }

  if (type === "spot") {
    return "Spot";
  }

  return null;
}

export function MarketSwitcherRow({
  isActive,
  isFavorite,
  isSelected,
  market,
  onHover,
  onSelect,
  onToggleFavorite,
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
  const marketTokenIcons = getMarketTokenIcons(market.pair);
  const instrumentDetail = getInstrumentDetailDisplay(market);
  const instrumentTypePillLabel = getInstrumentTypePillLabel(market.type);

  return (
    <div
      data-market-row={market.id}
      className={cn(
        "flex w-full items-center gap-4 rounded-[20px] p-4 text-left transition-colors hover:bg-white/4.5",
        isActive && "bg-white/5.5",
        isSelected && "bg-white/9 ring-1 ring-white/25",
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
          {marketTokenIcons.length > 0 ? (
            <span className="flex shrink-0 items-center -space-x-1">
              {marketTokenIcons.map((tokenIcon) => (
                <SmartImage<string>
                  alt={tokenIcon.symbol}
                  className="size-7 overflow-hidden rounded-full bg-white/12 p-0.5 ring-1 ring-black/30 contrast-125 grayscale"
                  key={tokenIcon.symbol}
                  src={tokenIcon.src}
                />
              ))}
            </span>
          ) : (
            <SmartImage<string>
              alt={`${market.pair} flag`}
              className="h-6 w-9 shrink-0 overflow-hidden rounded-[4px] grayscale"
              imgClassName="object-cover"
              src={market.flagSrc}
            />
          )}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-x-3">
              <span className="truncate font-semibold text-[15px] text-white leading-tight">
                {formatFxDisplayPair(market.pair)}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                {instrumentTypePillLabel ? (
                  <span className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 font-semibold text-[10px] text-white/78 uppercase leading-none tracking-[0.04em]">
                    {instrumentTypePillLabel}
                  </span>
                ) : null}
                <span className="truncate font-medium text-[14px] text-white/50 leading-tight">
                  {market.type === "future" ? market.expiryLabel ?? instrumentDetail : instrumentDetail}
                </span>
              </span>
            </div>
          </div>
        </div>
      </button>

      <button
        aria-label={isFavorite ? "Remove favorite" : "Add favorite"}
        className={cn(
          "rounded-full p-2 transition-colors",
          isFavorite
            ? "bg-white text-black hover:bg-white/90"
            : "bg-transparent text-white/28 hover:bg-white/7 hover:text-white/75",
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
