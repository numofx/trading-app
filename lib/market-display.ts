import type { MarketDefinition, MarketType } from "@/lib/trading.types";

const KNOWN_QUOTES = ["cNGN", "EURC", "USDC", "USDT", "BRZ", "USD", "EUR", "GBP", "JPY", "KES", "NGN"] as const;

export function formatFxDisplayPair(symbol: string) {
  const quote = KNOWN_QUOTES.find((candidate) => symbol.endsWith(candidate));

  if (!quote) {
    return symbol;
  }

  const base = symbol.slice(0, -quote.length);

  if (!base) {
    return symbol;
  }

  return `${base}/${quote}`;
}

export function getProductDisplayName(type: MarketType) {
  if (type === "future") {
    return "Futures";
  }

  if (type === "option") {
    return "Options";
  }

  if (type === "perp") {
    return "Perp";
  }

  return "Spot";
}

function getInstrumentTypeDisplayName(type: MarketType) {
  if (type === "future") {
    return "Future";
  }

  if (type === "option") {
    return "Option";
  }

  if (type === "perp") {
    return "Perp";
  }

  return "Spot";
}

export function getInstrumentDetailDisplay(market: MarketDefinition) {
  const product = getInstrumentTypeDisplayName(market.type);

  if (market.type === "spot") {
    return product;
  }

  return market.expiryLabel ? `${product} · ${market.expiryLabel}` : product;
}

const EXPIRY_MONTH_CODES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

/** Dash-separated pair for instrument tickers, e.g. "USDC-cNGN". */
export function formatFxDashPair(symbol: string) {
  return formatFxDisplayPair(symbol).replace("/", "-");
}

/** Formats a unix expiry timestamp (seconds, UTC) as a contract date code, e.g. "16 SEP 26". */
function formatExpiryDateCode(expiryTimestamp: number) {
  const date = new Date(expiryTimestamp * 1000);
  const year = String(date.getUTCFullYear() % 100).padStart(2, "0");

  return `${date.getUTCDate()} ${EXPIRY_MONTH_CODES[date.getUTCMonth()]} ${year}`;
}

export function getInstrumentDisplayLabel(market: MarketDefinition) {
  if (market.type === "spot") {
    return formatFxDashPair(market.pair);
  }

  if (market.type === "future" && market.expiryTimestamp) {
    return `${formatFxDashPair(market.pair)} ${formatExpiryDateCode(market.expiryTimestamp)}`;
  }

  return `${formatFxDisplayPair(market.pair)} ${getInstrumentTypeDisplayName(market.type)} · ${market.expiryLabel ?? "—"}`;
}

/** Market-switcher row subtext: settlement style and contract size, e.g. "Delivered • 10,000". */
export function getInstrumentSubtext(market: MarketDefinition) {
  const multiplier = Number((market.contractMultiplier ?? "").replaceAll(",", ""));

  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return "Delivered";
  }

  return `Delivered • ${multiplier.toLocaleString("en-US")}`;
}

export function getSelectedInstrumentDisplay(market: MarketDefinition) {
  return {
    expiryLabel: market.type === "spot" ? null : market.expiryLabel ?? "—",
    pairLabel: formatFxDisplayPair(market.pair),
    typeLabel: getInstrumentTypeDisplayName(market.type),
  };
}

export function getDisplayExpiryLabel(market: MarketDefinition) {
  return market.expiryLabel ?? "—";
}
