import type { MarketDefinition, MarketType } from "@/lib/trading.types";

const KNOWN_QUOTES = ["cNGN", "USDC", "USDT", "USD", "EUR", "GBP", "JPY", "KES", "NGN"] as const;

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

export function getInstrumentDetailDisplay(market: MarketDefinition) {
  const product = getProductDisplayName(market.type);

  if (market.type === "spot") {
    return product;
  }

  return market.expiryLabel ? `${product} · ${market.expiryLabel}` : product;
}

export function getInstrumentDisplayLabel(market: MarketDefinition) {
  if (market.type === "spot") {
    return `${formatFxDisplayPair(market.pair)} Spot`;
  }

  return `${formatFxDisplayPair(market.pair)} ${getProductDisplayName(market.type)} · ${market.expiryLabel ?? "—"}`;
}

export function getSelectedInstrumentDisplay(market: MarketDefinition) {
  return {
    label: getInstrumentDisplayLabel(market),
  };
}

export function getDisplayExpiryLabel(market: MarketDefinition) {
  return market.expiryLabel ?? "—";
}
