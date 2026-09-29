"use client";

import { Duration } from "effect";
import { useEffect, useState } from "react";
import { parsePositionsResponse } from "@/lib/perp-market";
import type { PerpAccountMargin, PerpPosition } from "@/lib/perp-market.types";

const POLL_INTERVAL_MS = Duration.toMillis("15 seconds");

type PerpPositionsState = {
  account: PerpAccountMargin | null;
  positions: PerpPosition[];
  status: "idle" | "loading" | "ready" | "error";
};

const IDLE: PerpPositionsState = { account: null, positions: [], status: "idle" };

/**
 * The perp account's positions and margin from `/v1/positions`, re-read every 15 seconds: margin
 * moves with every mark, so a snapshot from page load would show a liquidation price that no longer
 * holds. `refresh` re-reads at once, after a fill or a deposit.
 */
export function usePerpPositions(subaccountId: string | null) {
  const [state, setState] = useState<PerpPositionsState>(IDLE);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (subaccountId === null) {
      setState(IDLE);
      return;
    }

    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/positions?subaccount_id=${subaccountId}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`positions returned ${response.status}`);
        }
        const parsed = parsePositionsResponse(await response.json());
        if (!cancelled) {
          setState({ ...parsed, status: "ready" });
        }
      } catch {
        // Keep the last good read on screen rather than blanking it on one failed poll.
        if (!cancelled) {
          setState((current) => ({ ...current, status: "error" }));
        }
      }
    }

    setState((current) =>
      current.status === "idle" ? { ...current, status: "loading" } : current
    );
    void load();
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [subaccountId, refreshKey]);

  return { ...state, refresh: () => setRefreshKey((key) => key + 1) };
}
