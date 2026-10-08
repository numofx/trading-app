import { MARKET_LABELS } from "@/lib/market-labels";
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
  { href: "/", id: "spot", kind: "spot", symbol: MARKET_LABELS["cNGN-USDC"] },
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
    openInterestUsd: perp?.openInterestUsd ?? null,
    price,
    volume24hUsd: market.stats24h?.quoteVolume ?? null,
  };
}

/**
 * The entries one tab lists, narrowed by the search box: a case-insensitive match of every word
 * the trader typed against the symbol, separators ignored, so "cngn perp", "cngn-perp" and
 * "cngnperp" all find cNGN-PERP.
 */
export function filterTerminalMarkets(
  entries: readonly TerminalMarketEntry[],
  kind: TerminalMarketKind,
  query: string
): TerminalMarketEntry[] {
  const needles = query
    .toLowerCase()
    .split(SYMBOL_SEPARATORS)
    .filter((word) => word !== "");
  return entries.filter((entry) => {
    const symbol = normalizeSymbol(entry.symbol);
    return entry.kind === kind && needles.every((needle) => symbol.includes(needle));
  });
}

const SYMBOL_SEPARATORS = /[\s\-_/]+/g;

function normalizeSymbol(value: string) {
  return value.toLowerCase().replace(SYMBOL_SEPARATORS, "");
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
