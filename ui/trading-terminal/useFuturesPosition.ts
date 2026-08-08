"use client";

import { Duration } from "effect";
import { useEffect, useState } from "react";
import { fetchFuturesPosition } from "@/lib/deliverable-fx-margin";

const REFRESH_INTERVAL_MS = Duration.toMillis("20 seconds");

/**
 * The subaccount's signed position in the selected futures series, in contracts, or null when
 * there is no subaccount yet or the ledger cannot be read.
 *
 * Polled because settlement is asynchronous: the executor submits the trade after the order
 * matches, so the position moves some time after a fill rather than on submission.
 */
export function useFuturesPosition({
  assetAddress,
  subaccountId,
  subId,
}: {
  assetAddress: string | null | undefined;
  subaccountId: string | null;
  subId: string | null | undefined;
}) {
  const [position, setPosition] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!(subaccountId && assetAddress && subId)) {
      setPosition(null);
      return () => {
        cancelled = true;
      };
    }

    function refresh() {
      void fetchFuturesPosition({
        accountId: subaccountId as string,
        assetAddress: assetAddress as string,
        subId: subId as string,
      }).then((next) => {
        if (!cancelled) {
          setPosition(next);
        }
      });
    }

    refresh();
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [assetAddress, subaccountId, subId]);

  return position;
}
