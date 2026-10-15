import { MARKET_LABELS } from "@/lib/market-labels";
import type {
  MarketOverviewRow,
  TerminalMarketEntry,
  TerminalMarketId,
  TerminalMarketKind,
} from "@/lib/market-overview.types";
import { futurePath, marketPath } from "@/lib/market-routes";
import { PERP_MARKET_LABEL } from "@/lib/perp-terminal-config";
import { getAnchorPrice, getBestPrices } from "@/lib/spot-market";
import { invertPrice, toUsdcCngnStats } from "@/lib/spot-orientation";
import { formatCompactVolume, get24hStats, getVenueLastPrice } from "@/lib/ticker-stats";
import type { SpotMarket } from "@/lib/trading.types";

const SPOT_ENTRY = {
  href: marketPath("spot"),
  id: "spot",
  kind: "spot",
  symbol: MARKET_LABELS["cNGN-USDC"],
} as const satisfies TerminalMarketEntry;

/**
 * The perp, which is winding down: close-only on its old accounts, then withdrawals. It is out of
 * the selector and reachable at `/perp`; the entry names it in the header pill on its own page.
 */
const PERP_ENTRY = {
  href: marketPath("perp"),
  id: "perp",
  kind: "perp",
  symbol: PERP_MARKET_LABEL,
} as const satisfies TerminalMarketEntry;

/** A future series' entry, under the venue's own symbol. */
export function futureEntry(symbol: string): TerminalMarketEntry {
  return { href: futurePath(symbol), id: "future", kind: "futures", symbol };
}

/**
 * The markets the selector offers, each at its own URL under `/trade`: spot, and the future series
 * the venue lists (`futureSymbol`, null when it lists none). The shell (header, wallet, trading
 * account, selector) persists across them; the market's panels are keyed by the slug, so switching
 * never carries one market's ticket or book into the other.
 */
export function selectorMarkets(futureSymbol: string | null): TerminalMarketEntry[] {
  return futureSymbol === null ? [SPOT_ENTRY] : [SPOT_ENTRY, futureEntry(futureSymbol)];
}

/** The entry for the market on screen; a future needs its series' symbol. */
export function getTerminalMarket(
  id: TerminalMarketId,
  futureSymbol: string | null = null
): TerminalMarketEntry {
  if (id === "perp") {
    return PERP_ENTRY;
  }
  if (id === "future" && futureSymbol !== null) {
    return futureEntry(futureSymbol);
  }
  return SPOT_ENTRY;
}

/** A row with nothing served: every figure a dash. */
export function emptyOverviewRow(id: TerminalMarketId): MarketOverviewRow {
  return {
    changePercent24h: null,
    fundingRate1h: null,
    id,
    expiryMs: null,
    lastTradeAtMs: null,
    openInterestUsd: null,
    price: null,
    symbol: null,
    volume24hUsd: null,
  };
}

/**
 * The selector's figures for one market, derived exactly as that market's own header derives
 * them: the price is the book's mid (else one side, else the last trade), the change is measured
 * from the window's first trade to the last, and the volume is the window's USDC notional.
 * `markPrice` is the perp's fallback when nothing rests and nothing traded; spot has none. Spot is
 * shown USDC-cNGN, so its price and change are the venue's turned over: cNGN per USDC.
 *
 * The future passes its mark and last trade time, and its volume in contracts: the venue's quote
 * volume on it is price × contracts, not money, so the USDC notional is the contracts at their size.
 */
export function buildOverviewRow(
  id: TerminalMarketId,
  market: SpotMarket,
  perp: {
    markPrice: number;
    openInterestUsd: number;
    uiLongFundingRate1h: number;
  } | null,
  future: {
    expiryMs: number;
    lastTradeAtMs: number;
    markPrice: number | null;
    symbol: string;
    /** The venue's size unit as USDC of notional: what its volume counts. */
    unitUsdc: number;
    volumeUnits: number | null;
  } | null = null
): MarketOverviewRow {
  const lastPrice = getVenueLastPrice(market.trades, market.candles, market.mark);
  const { bestAsk, bestBid } = getBestPrices(market.orderBookAsks, market.orderBookBids);
  const enginePrice =
    getAnchorPrice(bestAsk, bestBid, lastPrice) ?? perp?.markPrice ?? future?.markPrice ?? null;
  const isSpot = id === "spot";
  const price = isSpot ? invertPrice(enginePrice) : enginePrice;
  const { changePercent } = isSpot
    ? get24hStats(toUsdcCngnStats(market.stats24h), invertPrice(lastPrice))
    : get24hStats(market.stats24h, lastPrice);
  const futureVolume = future?.volumeUnits == null ? null : future.volumeUnits * future.unitUsdc;
  return {
    changePercent24h: changePercent,
    fundingRate1h: perp?.uiLongFundingRate1h ?? null,
    id,
    expiryMs: future?.expiryMs ?? null,
    lastTradeAtMs: future?.lastTradeAtMs ?? null,
    openInterestUsd: perp?.openInterestUsd ?? null,
    price,
    symbol: future?.symbol ?? null,
    volume24hUsd: future === null ? (market.stats24h?.quoteVolume ?? null) : futureVolume,
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
