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
  isActive: boolean;
  isFavorite: boolean;
  isSelected: boolean;
  market: MarketDefinition;
  onHover: () => void;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  const marketTokenIcons = getMarketTokenIcons(market.pair);
  const instrumentDetail = getInstrumentDetailDisplay(market);
  const instrumentTypePillLabel = getInstrumentTypePillLabel(market.type);

  return (
    <div
      data-market-row={market.id}
      className={cn(
        "flex w-full items-center gap-4 rounded-[20px] p-4 text-left transition-colors hover:bg-input-hover",
        isActive && "bg-input-bg",
        isSelected && "bg-toolbar-active-bg ring-1 ring-panel-border",
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
                  className="size-7 overflow-hidden rounded-full bg-input-bg p-0.5 ring-1 ring-panel-border"
                  key={tokenIcon.symbol}
                  src={tokenIcon.src}
                />
              ))}
            </span>
          ) : (
            <SmartImage<string>
              alt={`${market.pair} flag`}
              className="h-6 w-9 shrink-0 overflow-hidden rounded-[4px]"
              imgClassName="object-cover"
              src={market.flagSrc}
            />
          )}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-x-3">
              <span className="truncate font-semibold text-[15px] text-panel-text-active leading-tight">
                {formatFxDisplayPair(market.pair)}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                {instrumentTypePillLabel ? (
                  <span className="shrink-0 rounded-md bg-input-bg px-2 py-0.5 font-semibold text-[10px] text-panel-text-active uppercase leading-none tracking-[0.04em]">
                    {instrumentTypePillLabel}
                  </span>
                ) : null}
                <span className="truncate font-medium text-[14px] text-panel-text-muted leading-tight">
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
            ? "bg-foreground text-background hover:bg-foreground/90"
            : "bg-transparent text-panel-text-muted hover:bg-input-hover hover:text-panel-text-active",
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
