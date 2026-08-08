"use client";

import { useEffect, useState } from "react";
import type { MarginSchedule } from "@/lib/deliverable-fx-margin";
import { fetchMarginSchedule, resolveInitialMarginRate } from "@/lib/deliverable-fx-margin";

/**
 * Resolves the venue's initial-margin requirement for a deliverable FX series, as a fraction of
 * USDC notional.
 *
 * Returns null while loading and whenever the schedule cannot be read, so the ticket shows no
 * margin quote instead of a made-up one. The schedule is static apart from the near-expiry ramp,
 * so it is fetched once per series and the ramp is re-evaluated locally on a timer.
 */
export function useInitialMarginRate({
  assetAddress,
  subId,
}: {
  assetAddress: string | null | undefined;
  subId: string | null | undefined;
}) {
  const [schedule, setSchedule] = useState<MarginSchedule | null>(null);
  const [rate, setRate] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!(assetAddress && subId)) {
      setSchedule(null);
      return () => {
        cancelled = true;
      };
    }

    setSchedule(null);
    void fetchMarginSchedule({ assetAddress, subId }).then((next) => {
      if (!cancelled) {
        setSchedule(next);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [assetAddress, subId]);

  useEffect(() => {
    if (!schedule) {
      setRate(null);
      return;
    }

    function applyRate() {
      // `schedule` is captured non-null: this effect returns early above when it is null.
      setRate(resolveInitialMarginRate(schedule as MarginSchedule, Math.floor(Date.now() / 1000)));
    }

    applyRate();

    // Only moves during the ramp window; a minute is far finer than the 3-day ramp needs.
    const timer = window.setInterval(applyRate, 60_000);
    return () => window.clearInterval(timer);
  }, [schedule]);

  return rate;
}
