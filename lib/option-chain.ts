import type { MarketPresentation } from "@/lib/markets-service";

/**
 * cNGN options on MarginEngine v2, as the venue lists them: one market per strike and side
 * (`cNGN-30NOV26-0.00072-P`, contract_type "option", with an `option` block). A premium is in USDC per
 * cNGN; one unit of `desired_amount` is `amount_scale / 1e18` cNGN (1,000 for cNGN). Each expiry is a
 * chain: its strikes, each with a call and a put.
 */

/** One strike and side, with its best resting prices. Every figure is null when the venue served none. */
export type OptionOverviewRow = {
  symbol: string;
  baseSymbol: string;
  /** The strike as the venue lists it ("0.00072"), and as a number for ordering. */
  strikeLabel: string;
  strike: number;
  optionType: "call" | "put";
  /** Epoch ms: when the series settles, and when the venue stops taking orders on it. */
  expiryMs: number;
  lastTradeAtMs: number | null;
  tradingOpen: boolean;
  /** Best bid and ask, premium in USDC per base unit. */
  bid: number | null;
  ask: number | null;
  /** The engine's own mark, in the same unit: what a position is margined at. */
  mark: number | null;
  /** The size resting at the best bid and ask, in base units (cNGN). */
  bidSize: number | null;
  askSize: number | null;
};

/** One expiry's chain: its strikes in ascending order, each with the call and put rows it lists. */
export type OptionChain = {
  baseSymbol: string;
  expiryMs: number;
  lastTradeAtMs: number | null;
  /** The forward the engine prices this expiry on, from its marks; null without a call and put mark. */
  forward: number | null;
  /** The series name without strike or side: `cNGN-30NOV26`. */
  series: string;
  strikes: {
    strike: number;
    strikeLabel: string;
    call: OptionOverviewRow | null;
    put: OptionOverviewRow | null;
  }[];
};

export type OptionPresentation = {
  strike?: string;
  option_type?: string;
  expiry_timestamp?: number;
  last_trade_time?: number;
  vol_feed_address?: string;
  trading_open?: boolean;
};

const E18 = 10n ** 18n;
const WHOLE_NUMBER = /^\d+$/;

/**
 * How many base units one `desired_amount` is: `amount_scale / 1e18`, the venue's own statement of the
 * unit (1e21 → 1,000 cNGN). Null when the listing names no whole-unit scale: a size cannot be shown then.
 */
export function optionUnitBase(amountScale: string | undefined): number | null {
  if (amountScale === undefined || !WHOLE_NUMBER.test(amountScale.trim())) {
    return null;
  }
  const scale = BigInt(amountScale.trim());
  if (scale <= 0n || scale % E18 !== 0n) {
    return null;
  }
  return Number(scale / E18);
}

/** The listed option markets not yet expired, as rows without prices. */
export function listLiveOptions(
  markets: readonly MarketPresentation[],
  nowMs: number
): MarketPresentation[] {
  return markets.filter((market) => {
    const option = market.option;
    const expiry = option?.expiry_timestamp ?? market.expiry_timestamp;
    return (
      market.contract_type === "option" &&
      option !== undefined &&
      (option.option_type === "call" || option.option_type === "put") &&
      Number.isFinite(Number(option.strike)) &&
      Number(option.strike) > 0 &&
      expiry !== undefined &&
      expiry * 1000 > nowMs
    );
  });
}

/**
 * A listed option and its book's best levels as an overview row. Book sizes are the venue's units and
 * are shown in base units; a listing without a whole-unit scale shows no size rather than a wrong one.
 */
export function buildOptionRow(
  market: MarketPresentation,
  best: {
    bid: { price: number; size: number } | null;
    ask: { price: number; size: number } | null;
    mark?: number | null;
  }
): OptionOverviewRow {
  const option = market.option ?? {};
  const unit = optionUnitBase(market.amount_scale);
  const sized = (level: { size: number } | null) =>
    level === null || unit === null || !Number.isFinite(level.size) ? null : level.size * unit;
  const price = (level: { price: number } | null) =>
    level !== null && Number.isFinite(level.price) && level.price > 0 ? level.price : null;
  const expiry = option.expiry_timestamp ?? market.expiry_timestamp ?? 0;
  return {
    ask: price(best.ask),
    askSize: sized(best.ask),
    baseSymbol: market.base_asset_symbol ?? "",
    bid: price(best.bid),
    bidSize: sized(best.bid),
    expiryMs: expiry * 1000,
    lastTradeAtMs: option.last_trade_time === undefined ? null : option.last_trade_time * 1000,
    mark: best.mark !== null && best.mark !== undefined && best.mark > 0 ? best.mark : null,
    optionType: option.option_type === "put" ? "put" : "call",
    strike: Number(option.strike),
    strikeLabel: option.strike ?? "",
    symbol: market.market,
    tradingOpen: option.trading_open === true,
  };
}

/** `cNGN-30NOV26-0.00072-P` → `cNGN-30NOV26`: the symbol without its strike and side. */
export function optionSeries(symbol: string): string {
  return symbol.split("-").slice(0, -2).join("-");
}

/**
 * The forward by put-call parity on the engine's marks: undiscounted Black-76 has call - put = forward - strike
 * exactly, whatever the vol. Read off the strike whose two marks are largest, where rounding matters least.
 */
function forwardFromMarks(strikes: OptionChain["strikes"]): number | null {
  let forward: number | null = null;
  let weight = 0;
  for (const { call, put, strike } of strikes) {
    if (call?.mark && put?.mark && call.mark + put.mark > weight) {
      forward = call.mark - put.mark + strike;
      weight = call.mark + put.mark;
    }
  }
  return forward;
}

/**
 * The rows grouped into chains, nearest expiry first, each with its strikes ascending and a call and a
 * put per strike where the venue lists them.
 */
export function buildOptionChains(rows: readonly OptionOverviewRow[]): OptionChain[] {
  const chains = new Map<string, OptionChain>();
  for (const row of rows) {
    const series = optionSeries(row.symbol);
    const key = `${series}|${row.expiryMs}`;
    let chain = chains.get(key);
    if (chain === undefined) {
      chain = {
        baseSymbol: row.baseSymbol,
        expiryMs: row.expiryMs,
        forward: null,
        lastTradeAtMs: row.lastTradeAtMs,
        series,
        strikes: [],
      };
      chains.set(key, chain);
    }
    let strike = chain.strikes.find((candidate) => candidate.strike === row.strike);
    if (strike === undefined) {
      strike = { call: null, put: null, strike: row.strike, strikeLabel: row.strikeLabel };
      chain.strikes.push(strike);
    }
    strike[row.optionType] = row;
  }
  return [...chains.values()]
    .map((chain) => ({
      ...chain,
      forward: forwardFromMarks(chain.strikes),
      strikes: [...chain.strikes].sort((a, b) => a.strike - b.strike),
    }))
    .sort((left, right) => left.expiryMs - right.expiryMs);
}

/** A premium in USDC per base unit at the precision a cNGN premium needs: 0.00002895. */
export function formatPremium(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return "—";
  }
  return value.toFixed(8);
}

/** A vol as the chain shows it: 43.2%. */
export function formatVol(vol: number | null): string {
  return vol === null ? "—" : `${(vol * 100).toFixed(1)}%`;
}

function utcDate(expiryMs: number, options: Intl.DateTimeFormatOptions) {
  return new Date(expiryMs).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}

/** An expiry's tab, in UTC, as its symbol names the day: `Nov 30`, with the year once it is not this one. */
export function formatExpiryTab(expiryMs: number, nowMs: number): string {
  const day = utcDate(expiryMs, { day: "numeric", month: "short" });
  const sameYear = new Date(expiryMs).getUTCFullYear() === new Date(nowMs).getUTCFullYear();
  return sameYear ? day : `${day} ${new Date(expiryMs).getUTCFullYear()}`;
}

/** The expiry's day over the chain, in UTC: `Mon Nov 30`. */
export function formatExpiryDay(expiryMs: number): string {
  const weekday = utcDate(expiryMs, { weekday: "short" });
  return `${weekday} ${utcDate(expiryMs, { day: "numeric", month: "short" })}`;
}

/** The time left to expiry, never negative: `28d 7h 12m`. */
export function formatTimeToExpiry(expiryMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((expiryMs - nowMs) / 60_000));
  return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes / 60) % 24}h ${minutes % 60}m`;
}
