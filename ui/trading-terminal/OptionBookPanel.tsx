"use client";

import { Duration } from "effect";
import { useEffect, useState } from "react";
import type { OptionOverviewRow } from "@/lib/option-chain";
import { optionUnitBase } from "@/lib/option-chain";
import type { OptionBook } from "@/lib/option-chain-read";
import type { SpotBookTab } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { SpotOrderBookPanel } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { useLiveMarketBook } from "@/ui/trading-terminal/useLiveMarketBook";

/** The REST read the stream falls back to, and the trades it was seeded with. */
const SNAPSHOT_REFRESH_MS = Duration.toMillis("15 seconds");

/** A premium's precision: ladder groups down to its last shown place. */
const PREMIUM_DECIMALS = 8;
const PREMIUM_GROUPS = [0.000_000_01, 0.000_000_1, 0.000_001] as const;

const EMPTY_BOOK: OptionBook = {
  mark: null,
  orderBookAsks: [],
  orderBookBids: [],
  stats24h: null,
  trades: [],
};
const NO_CANDLES: [] = [];

function useOptionBookSnapshot(symbol: string) {
  const [book, setBook] = useState<OptionBook>(EMPTY_BOOK);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/option-book?symbol=${encodeURIComponent(symbol)}`, {
          cache: "no-store",
        });
        if (response.ok && !cancelled) {
          setBook((await response.json()) as OptionBook);
        }
      } catch {
        // Keep the last good read; the stream carries on regardless.
      }
    }
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void load();
      }
    }, SNAPSHOT_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [symbol]);
  return book;
}

function inBaseUnits<T extends { size: number }>(rows: T[], unit: number) {
  return rows.map((row) => ({ ...row, size: row.size * unit }));
}

/**
 * The chosen contract's book and trades, in the terminal's own panel: premium in USDC per base unit, sizes in the
 * base rather than the venue's units. The parent keys this by the contract, so a switch never shows another
 * strike's levels while its own arrive.
 */
export function OptionBookPanel({
  onTabChange,
  row,
  tab,
}: {
  onTabChange: (tab: SpotBookTab) => void;
  row: OptionOverviewRow;
  tab: SpotBookTab;
}) {
  const snapshot = useOptionBookSnapshot(row.symbol);
  const live = useLiveMarketBook({
    candles: NO_CANDLES,
    snapshot,
    symbol: row.symbol,
    type: "future",
  });
  const unit = optionUnitBase(row.amountScale ?? undefined) ?? 1;
  const base = row.baseSymbol || "cNGN";
  return (
    <SpotOrderBookPanel
      asks={inBaseUnits(live.asks, unit)}
      bids={inBaseUnits(live.bids, unit)}
      lastPrice={live.lastPrice}
      onTabChange={onTabChange}
      tab={tab}
      trades={inBaseUnits(live.trades, unit)}
      units={{
        base,
        price: "USDC",
        priceDecimals: PREMIUM_DECIMALS,
        priceGroups: PREMIUM_GROUPS,
        quote: "USDC",
      }}
    />
  );
}
