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
 * One fresh read of the account's positions and margin, bypassing every cache. The 15-second poll
 * below is what a row on screen was drawn from; a Close sizes itself from this instead, so a fill
 * the poll has not shown yet is already counted.
 */
export async function readPerpPositions(
  subaccountId: string
): Promise<Pick<PerpPositionsState, "account" | "positions">> {
  const response = await fetch(`/api/positions?subaccount_id=${subaccountId}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`positions returned ${response.status}`);
  }
  return parsePositionsResponse(await response.json());
}

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

    const account = subaccountId;
    let cancelled = false;
    async function load() {
      try {
        const parsed = await readPerpPositions(account);
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
