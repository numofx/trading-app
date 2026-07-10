"use client";

import { Duration } from "effect";
import { useEffect, useRef, useState } from "react";
import type { StrailsBookStatus, StrailsOrderBookPayload } from "@/lib/strails.types";

const POLL_INTERVAL_MS = Duration.toMillis("6 seconds");

// Statuses worth surfacing in the console: the upstream data existed but was not
// renderable as a real spread. `empty`/`unconfigured` are expected fallback states.
const DEGRADED_STATUSES = new Set<StrailsBookStatus>(["crossed", "implausible"]);

/**
 * Polls the server-side strails orderbook proxy. Returns live bid/ask levels only
 * when the book is renderable (`status === "ok"`); callers keep the preview book
 * for every other state so a crossed or missing LP board never renders as a spread.
 */
export function useStrailsOrderBook() {
  const [payload, setPayload] = useState<StrailsOrderBookPayload | null>(null);
  const lastLoggedStatusRef = useRef<StrailsBookStatus | null>(null);

  useEffect(() => {
    let isActive = true;

    async function poll() {
      try {
        const response = await fetch("/api/strails/orderbook", { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`strails orderbook proxy returned ${response.status}`);
        }

        const nextPayload = (await response.json()) as StrailsOrderBookPayload;

        if (!isActive) {
          return;
        }

        if (DEGRADED_STATUSES.has(nextPayload.status) && lastLoggedStatusRef.current !== nextPayload.status) {
          console.warn(`strails orderbook degraded (${nextPayload.status}); showing preview book`);
        }

        lastLoggedStatusRef.current = nextPayload.status;
        setPayload(nextPayload);
      } catch {
        if (isActive) {
          setPayload(null);
        }
      }
    }

    void poll();
    const intervalId = window.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const isLive = payload?.status === "ok" && payload.bids.length > 0 && payload.asks.length > 0;

  return {
    asks: isLive ? payload.asks : [],
    bids: isLive ? payload.bids : [],
    isLive,
    status: payload?.status ?? null,
  };
}
