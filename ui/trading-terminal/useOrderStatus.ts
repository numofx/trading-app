"use client";

import { Duration } from "effect";
import { useEffect, useState } from "react";

const SETTLED_CLEAR_MS = Duration.toMillis("5 seconds");
const FALLBACK_CLEAR_MS = Duration.toMillis("30 seconds");

type Status = {
  message: string;
  /** What the account looked like when the order was accepted; a change means it filled. */
  awaitedSignature: string | null;
  /** A terminal message (filled, rejected): cleared sooner than one still waiting on the venue. */
  settled: boolean;
};

/**
 * The line under the submit button. A message lasts until the form is edited, or 30 seconds,
 * whichever comes first; a settled one (filled, rejected) five seconds. While an accepted order
 * is awaited, a change in `fillSignature`, the account's positions or balances as the caller
 * summarises them, reads as the fill and shows "Filled".
 */
export function useOrderStatus(fillSignature: string) {
  const [status, setStatus] = useState<Status | null>(null);
  const filled =
    status !== null &&
    status.awaitedSignature !== null &&
    status.awaitedSignature !== fillSignature;
  const settled = status !== null && (status.settled || filled);

  useEffect(() => {
    if (status === null) {
      return;
    }
    const timer = window.setTimeout(
      () => setStatus(null),
      settled ? SETTLED_CLEAR_MS : FALLBACK_CLEAR_MS
    );
    return () => window.clearTimeout(timer);
  }, [status, settled]);

  return {
    /** Something the trader should read; null once it has been read or edited away. */
    status: filled ? "Filled" : (status?.message ?? null),
    /** A step in flight, e.g. awaiting a signature, or an acceptance to watch for the fill of. */
    announce(message: string, options: { awaitFill?: boolean } = {}) {
      setStatus({
        awaitedSignature: options.awaitFill ? fillSignature : null,
        message,
        settled: false,
      });
    },
    /** The trader moved on: any form edit. */
    clear() {
      setStatus(null);
    },
    /** The order's outcome, from the venue or a failure: shown briefly. */
    settle(message: string) {
      setStatus({ awaitedSignature: null, message, settled: true });
    },
  };
}
