import type {
  MarketOverviewRow,
  TerminalMarketEntry,
  TerminalMarketId,
  TerminalMarketKind,
} from "@/lib/market-overview.types";
import { PERP_MARKET_LABEL } from "@/lib/perp-terminal-config";
import { getAnchorPrice, getBestPrices } from "@/lib/spot-market";
import { formatCompactVolume, get24hStats, getVenueLastPrice } from "@/lib/ticker-stats";
import type { SpotMarket } from "@/lib/trading.types";

/**
 * The markets the selector offers. Each is its own route, so the terminals never share state:
 * switching never carries one terminal's ticket or book into the other, and each has its own URL.
 */
export const TERMINAL_MARKETS = [
  { href: "/", id: "spot", kind: "spot", symbol: "USDC-cNGN" },
  { href: "/perp", id: "perp", kind: "perp", symbol: PERP_MARKET_LABEL },
] as const satisfies readonly TerminalMarketEntry[];

export function getTerminalMarket(id: TerminalMarketId): TerminalMarketEntry {
  return TERMINAL_MARKETS.find((entry) => entry.id === id) ?? TERMINAL_MARKETS[0];
}

/** A row with nothing served: every figure a dash. */
export function emptyOverviewRow(id: TerminalMarketId): MarketOverviewRow {
  return {
    changePercent24h: null,
    fundingRate1h: null,
    id,
    maxLeverage: null,
    openInterestUsd: null,
    price: null,
    volume24hUsd: null,
  };
}

/**
 * The selector's figures for one market, derived exactly as that market's own header derives
 * them: the price is the book's mid (else one side, else the last trade), the change is measured
 * from the window's first trade to that price, and the volume is the window's USDC notional.
 * `markPrice` is the perp's fallback when nothing rests and nothing traded; spot has none.
 */
export function buildOverviewRow(
  id: TerminalMarketId,
  market: SpotMarket,
  perp: {
    markPrice: number;
    openInterestUsd: number;
    uiLongFundingRate1h: number;
    maxLeverage: number;
  } | null
): MarketOverviewRow {
  const lastPrice = getVenueLastPrice(market.trades, market.candles, market.mark);
  const { bestAsk, bestBid } = getBestPrices(market.orderBookAsks, market.orderBookBids);
  const price = getAnchorPrice(bestAsk, bestBid, lastPrice) ?? perp?.markPrice ?? null;
  const { changePercent } = get24hStats(market.stats24h, price);
  return {
    changePercent24h: changePercent,
    fundingRate1h: perp?.uiLongFundingRate1h ?? null,
    id,
    maxLeverage: perp?.maxLeverage ?? null,
    openInterestUsd: perp?.openInterestUsd ?? null,
    price,
    volume24hUsd: market.stats24h?.quoteVolume ?? null,
  };
}

/**
 * The entries one tab lists, narrowed by the search box: a case-insensitive match on the symbol,
 * with the separators ignored so "usdccngn" and "usdc cngn" both find USDC-cNGN.
 */
export function filterTerminalMarkets(
  entries: readonly TerminalMarketEntry[],
  kind: TerminalMarketKind,
  query: string
): TerminalMarketEntry[] {
  const needle = normalizeSymbol(query);
  return entries.filter(
    (entry) =>
      entry.kind === kind && (needle === "" || normalizeSymbol(entry.symbol).includes(needle))
  );
}

function normalizeSymbol(value: string) {
  return value.toLowerCase().replace(/[\s\-_/]+/g, "");
}

export function formatOverviewVolume(value: number | null) {
  return formatCompactVolume(value ?? Number.NaN);
}

export function formatOpenInterest(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return "—";
  }
  return formatCompactVolume(value) === "—" ? "0 USDC" : formatCompactVolume(value);
}

/** The hourly rate as a signed percentage, the way the ticket quotes it: positive means longs pay. */
export function formatFundingRate(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const pct = (Math.abs(value) * 100).toFixed(4);
  if (value === 0) {
    return "0%/h";
  }
  return `${value > 0 ? "+" : "-"}${pct}%/h`;
}

export function formatMaxLeverage(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return `Up to ${Number.isInteger(value) ? value : value.toFixed(1)}x`;
}
