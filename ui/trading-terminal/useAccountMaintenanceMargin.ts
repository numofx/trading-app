"use client";

import { Duration } from "effect";
import { useEffect, useState } from "react";
import { fetchAccountMaintenanceMargin } from "@/lib/deliverable-fx-margin";

const REFRESH_INTERVAL_MS = Duration.toMillis("30 seconds");

/**
 * The subaccount's maintenance margin in USDC, or null when there is no subaccount yet or the
 * manager will not report one.
 *
 * Polled rather than derived: it moves with every fill, deposit, mark update and cNGN spot tick,
 * and the manager is the only thing that knows the answer.
 */
export function useAccountMaintenanceMargin(subaccountId: string | null) {
  const [margin, setMargin] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!subaccountId) {
      setMargin(null);
      return () => {
        cancelled = true;
      };
    }

    function refresh() {
      void fetchAccountMaintenanceMargin(subaccountId as string).then((next) => {
        if (!cancelled) {
          setMargin(next);
        }
      });
    }

    refresh();
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [subaccountId]);

  return margin;
}
