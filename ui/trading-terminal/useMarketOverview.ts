"use client";

import { Duration } from "effect";
import { useEffect, useSyncExternalStore } from "react";
import { emptyOverviewRow } from "@/lib/market-overview";
import type {
  MarketOverviewResponse,
  MarketOverviewRow,
  TerminalMarketId,
} from "@/lib/market-overview.types";

/**
 * A read is reused for this long: reopening the selector within it shows the same rows without
 * another round trip, and the figures are at most this stale.
 */
const OVERVIEW_TTL_MS = Duration.toMillis("10 seconds");

type OverviewRead = { readAt: number; rows: MarketOverviewRow[] };

/*
 * One store for every reader: the selector, which fetches on opening, and the shell's header,
 * which seeds a market switch from the same read. A store rather than a module variable so a
 * reader re-renders when a read lands, including a read the selector started that is still in
 * flight when the row is clicked.
 */
let overviewCache: OverviewRead | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readOverview() {
  return overviewCache;
}

function serverOverview(): OverviewRead | null {
  return null;
}

/**
 * Reads `/api/markets-overview` unless a read younger than `OVERVIEW_TTL_MS` is held or one is
 * already in flight. A failed read keeps the last one; the rows show dashes until one succeeds.
 */
export function loadOverview(): Promise<void> {
  if (overviewCache !== null && Date.now() - overviewCache.readAt < OVERVIEW_TTL_MS) {
    return Promise.resolve();
  }
  if (inFlight !== null) {
    return inFlight;
  }
  inFlight = (async () => {
    try {
      const response = await fetch("/api/markets-overview", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as MarketOverviewResponse;
      overviewCache = { readAt: Date.now(), rows: body.rows ?? [] };
      for (const listener of listeners) {
        listener();
      }
    } catch {
      // Keep the last read.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * The selector's table, read when the dialog opens and never while it is closed: no read on page
 * load and no polling. The row for the market on screen takes the header's live price and change
 * over the read, so the two never disagree while the selector is open.
 */
export function useMarketOverview(open: boolean, live: MarketOverviewRow) {
  const read = useSyncExternalStore(subscribe, readOverview, serverOverview);
  const rows = read?.rows ?? [];

  useEffect(() => {
    if (open) {
      void loadOverview();
    }
  }, [open]);

  return (id: TerminalMarketId): MarketOverviewRow => {
    const fetched = rows.find((row) => row.id === id) ?? emptyOverviewRow(id);
    if (id !== live.id) {
      return fetched;
    }
    return {
      ...fetched,
      changePercent24h: live.changePercent24h ?? fetched.changePercent24h,
      price: live.price ?? fetched.price,
    };
  };
}

/**
 * The venue's last read of `market`, for the shell to seed the header from while the market's
 * panels load after a switch. A switch comes through the selector, which fetches on opening, so
 * the read is usually seconds old; `maxAgeMs` bounds what a back-button navigation may reuse.
 * Null without a read young enough. Re-renders the caller when a read lands.
 */
export function useCachedOverviewRow(
  market: TerminalMarketId,
  maxAgeMs: number
): MarketOverviewRow | null {
  const read = useSyncExternalStore(subscribe, readOverview, serverOverview);
  if (read === null || Date.now() - read.readAt > maxAgeMs) {
    return null;
  }
  return read.rows.find((row) => row.id === market) ?? null;
}
