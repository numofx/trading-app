import { MARKET_LABELS } from "@/lib/market-labels";
import type {
  MarketOverviewRow,
  SpotMarketId,
  TerminalMarketEntry,
  TerminalMarketId,
  TerminalMarketKind,
} from "@/lib/market-overview.types";
import { futurePath, marketPath } from "@/lib/market-routes";
import { PERP_MARKET_LABEL } from "@/lib/perp-terminal-config";
import { getAnchorPrice, getBestPrices } from "@/lib/spot-market";
import { spotOrientation } from "@/lib/spot-orientation";
import { isSpotMarketId, SPOT_PAIRS } from "@/lib/spot-pairs";
import { formatCompactVolume, get24hStats, getVenueLastPrice } from "@/lib/ticker-stats";
import type { SpotMarket } from "@/lib/trading.types";

/** A spot pair's entry, under its display name: USDC-cNGN, EURC-USDC. */
function spotEntry(id: SpotMarketId): TerminalMarketEntry {
  return {
    href: marketPath(id),
    id,
    kind: "spot",
    symbol: MARKET_LABELS[SPOT_PAIRS[id].symbol],
  };
}

/**
 * The perp, delisted: out of the selector, and its page a 404 unless the venue lists it again. The
 * entry names it in the header pill on its own page while it is listed.
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
 * The markets the selector offers, each at its own URL under `/trade`: USDC-cNGN spot, the other
 * spot pairs the venue lists (`listedSpot`: EURC-USDC once it is served), and the future series it
 * lists (`futureSymbols`, nearest expiry first; empty when it lists none). The shell (header,
 * wallet, trading account, selector) persists across them; the market's panels are keyed by the
 * slug, so switching never carries one market's ticket or book into the other.
 */
export function selectorMarkets(
  futureSymbols: readonly string[],
  listedSpot: readonly SpotMarketId[] = []
): TerminalMarketEntry[] {
  const spot = listedSpot.filter((id) => id !== "spot").map(spotEntry);
  return [spotEntry("spot"), ...spot, ...futureSymbols.map(futureEntry)];
}

/**
 * The spot pairs beyond USDC-cNGN to list: those the venue's overview served a row for, and the one
 * on screen if it is missing, so the pill's own market is never absent from its list.
 */
export function listedSpotMarkets(
  rows: readonly MarketOverviewRow[],
  onScreen: TerminalMarketId
): SpotMarketId[] {
  return (Object.keys(SPOT_PAIRS) as SpotMarketId[]).filter(
    (id) => id !== "spot" && (id === onScreen || rows.some((row) => row.id === id))
  );
}

/** The series to list: the venue's, nearest expiry first, with the one on screen kept if it is missing. */
export function listedFutureSymbols(
  futures: readonly MarketOverviewRow[],
  onScreen: string | null
) {
  const symbols = [...futures]
    .filter((row) => row.symbol !== null)
    .sort(
      (left, right) =>
        (left.expiryMs ?? Number.POSITIVE_INFINITY) - (right.expiryMs ?? Number.POSITIVE_INFINITY)
    )
    .map((row) => row.symbol as string);
  const known = symbols.some((symbol) => symbol.toLowerCase() === onScreen?.toLowerCase());
  return onScreen === null || known ? symbols : [...symbols, onScreen];
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
  return spotEntry(isSpotMarketId(id) ? id : "spot");
}

/** A row with nothing served: every figure a dash. */
export function emptyOverviewRow(id: TerminalMarketId): MarketOverviewRow {
  return {
    changePercent24h: null,
    fundingRate1h: null,
    id,
    expiryMs: null,
    indexPrice: null,
    lastTradeAtMs: null,
    markPrice: null,
    markSource: null,
    openInterestUsd: null,
    price: null,
    settled: null,
    symbol: null,
    volume24hUsd: null,
  };
}

/**
 * The selector's figures for one market, derived exactly as that market's own header derives
 * them: the price is the book's mid (else one side, else the last trade), the change is measured
 * from the window's first trade to the last, and the volume is the window's USDC notional.
 * `markPrice` is the perp's fallback when nothing rests and nothing traded; spot has none. A spot
 * pair's price and change are in its displayed terms: USDC-cNGN's the venue's turned over, cNGN per
 * USDC; EURC-USDC's as served, USDC per EURC.
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
    indexPrice: number | null;
    lastTradeAtMs: number;
    markPrice: number | null;
    markSource: "book" | "carry" | null;
    openInterestUsd: number | null;
    settled: boolean;
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
  const orientation = isSpotMarketId(id) ? spotOrientation(SPOT_PAIRS[id]) : null;
  const price = orientation === null ? enginePrice : orientation.price(enginePrice);
  const { changePercent } =
    orientation === null
      ? get24hStats(market.stats24h, lastPrice)
      : get24hStats(orientation.stats(market.stats24h), orientation.price(lastPrice));
  const futureVolume = future?.volumeUnits == null ? null : future.volumeUnits * future.unitUsdc;
  return {
    changePercent24h: changePercent,
    fundingRate1h: perp?.uiLongFundingRate1h ?? null,
    id,
    expiryMs: future?.expiryMs ?? null,
    indexPrice: future?.indexPrice ?? null,
    lastTradeAtMs: future?.lastTradeAtMs ?? null,
    markPrice: future?.markPrice ?? null,
    markSource: future?.markSource ?? null,
    openInterestUsd: perp?.openInterestUsd ?? future?.openInterestUsd ?? null,
    price,
    settled: future?.settled ?? null,
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
