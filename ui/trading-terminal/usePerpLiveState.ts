"use client";

import { Duration } from "effect";
import { useEffect, useState } from "react";
import { parsePerpState } from "@/lib/perp-market";
import type { PerpMarket, PerpState } from "@/lib/perp-market.types";

const POLL_INTERVAL_MS = Duration.toMillis("10 seconds");

/**
 * The perp's chain state, re-read every 10 seconds from `/api/perp-state`, laid over the state the
 * page rendered with. The server listing is cached up to a minute and the ticket's enabled flag
 * follows `trading_enabled`, so without this a launch, or a guardian pause, showed only on the next
 * reload. A failed poll keeps the last good state; an unparseable block (the index feed stale, so
 * markets-service drops it) reads as not tradable, which is what the venue would answer too.
 */
export function usePerpLiveState(market: PerpMarket | null): PerpMarket | null {
  const [state, setState] = useState<PerpState | null>(null);
  const enabled = market !== null;

  useEffect(() => {
    if (!enabled) {
      setState(null);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/perp-state", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as {
          perp?: Parameters<typeof parsePerpState>[0] | null;
        };
        const parsed = parsePerpState(body.perp ?? undefined);
        if (!cancelled) {
          setState(parsed ?? { ...CLOSED_FALLBACK });
        }
      } catch {
        // Keep the last good read.
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  if (market === null || state === null) {
    return market;
  }
  // The block was missing: keep the prices the page had, but the venue is not accepting orders.
  if (state === CLOSED_FALLBACK || state.markPrice === 0) {
    return { ...market, state: { ...market.state, tradingEnabled: false } };
  }
  return { ...market, state };
}

/** Sentinel for "markets-service served the perp without its block": closed, prices unknown. */
const CLOSED_FALLBACK: PerpState = {
  fundingIntervalSeconds: 3600,
  indexPrice: 0,
  initialMarginRate: 0,
  maintenanceMarginRate: 0,
  markPrice: 0,
  maxLeverage: 1,
  openInterestUsd: 0,
  tradingEnabled: false,
  uiLongFundingRate1h: 0,
};
