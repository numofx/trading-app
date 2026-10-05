"use client";

import { Duration } from "effect";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const SERVER_REFRESH_MS = Duration.toMillis("60 seconds");

/**
 * Re-reads the server-rendered figures (24h stats, candles, the REST book snapshot) once a
 * minute, keeping client state. The stream keeps the chart and volume current between reads;
 * this corrects what the stream cannot, such as fills rolling out of the 24h window. Skipped
 * while the tab is hidden, where nothing is looking.
 */
export function useServerRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        router.refresh();
      }
    }, SERVER_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);
}
