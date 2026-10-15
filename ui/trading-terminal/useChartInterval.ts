"use client";

import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useOptimistic } from "react";
import type { ChartInterval } from "@/lib/chart-interval";
import { CHART_INTERVAL_PARAM } from "@/lib/chart-interval";

/**
 * The chart's selected interval and a setter. The page reads candles at the interval in the URL,
 * so selecting one replaces `?interval=` and the server re-renders with that interval's candles;
 * the pill moves at once and the chart keeps the old candles until the new ones arrive. The
 * interval the candles were actually rendered at stays `rendered`: streamed fills fold in at that.
 */
export function useChartInterval(rendered: ChartInterval) {
  const router = useRouter();
  const pathname = usePathname();
  const [selected, setSelected] = useOptimistic(rendered);

  function select(interval: ChartInterval) {
    startTransition(() => {
      setSelected(interval);
      const params = new URLSearchParams(window.location.search);
      params.set(CHART_INTERVAL_PARAM, interval);
      router.replace(`${pathname}?${params.toString()}` as Route, { scroll: false });
    });
  }

  return [selected, select] as const;
}
