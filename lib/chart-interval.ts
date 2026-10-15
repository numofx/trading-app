import type { CandleInterval } from "@/lib/markets-service";

/**
 * The candle intervals the price chart offers, each one markets-service serves from `/v1/candles`.
 * `1m` is left out: at the chart's 120 candles it spans two hours, too little to read on a young
 * market.
 */
export const CHART_INTERVALS = [
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
] as const satisfies readonly CandleInterval[];

export type ChartInterval = (typeof CHART_INTERVALS)[number];

/** Hourly, so a series that opened today still draws a line rather than one daily bar. */
export const DEFAULT_CHART_INTERVAL: ChartInterval = "1h";

/** The `?interval=` search param the chart's interval rides on, so the minute refresh keeps it. */
export const CHART_INTERVAL_PARAM = "interval";

export const CHART_INTERVAL_LABELS = {
  "1d": "D",
  "1h": "1H",
  "4h": "4H",
  "5m": "5m",
  "15m": "15m",
} satisfies Record<ChartInterval, string>;

/** The interval a search param names, or the default for anything the chart does not offer. */
export function parseChartInterval(value: string | string[] | null | undefined): ChartInterval {
  return CHART_INTERVALS.find((interval) => interval === value) ?? DEFAULT_CHART_INTERVAL;
}
