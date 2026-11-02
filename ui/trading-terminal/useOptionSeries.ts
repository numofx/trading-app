"use client";

import { Duration } from "effect";
import { useCallback, useEffect, useState } from "react";
import type { OptionSeriesPage } from "@/lib/option-chain-read";

/** The chain's book and marks move every few seconds; the page re-reads them this often. */
const OPTION_REFRESH_MS = Duration.toMillis("15 seconds");

type OptionSeriesRead = {
  /** Null until a read lands; a later failure keeps the last good one. */
  page: OptionSeriesPage | null;
  /** When `page` was read: its time to expiry and implied vols are of that moment. */
  readAtMs: number;
  /** The first read failed: there is nothing to show. */
  failed: boolean;
};

/** A series' chain, polled while the tab is visible. */
export function useOptionSeries(series: string): OptionSeriesRead & { refresh: () => void } {
  const [read, setRead] = useState<OptionSeriesRead>({ failed: false, page: null, readAtMs: 0 });
  const [request, setRequest] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/option-chain?series=${encodeURIComponent(series)}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`option chain returned ${response.status}`);
        }
        const page = (await response.json()) as OptionSeriesPage;
        if (!cancelled) {
          setRead({ failed: false, page, readAtMs: Date.now() });
        }
      } catch {
        if (!cancelled) {
          setRead((previous) =>
            previous.page === null ? { ...previous, failed: true } : previous
          );
        }
      }
    }
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void load();
      }
    }, OPTION_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [series, request]);

  const refresh = useCallback(() => setRequest((current) => current + 1), []);
  return { ...read, refresh };
}
