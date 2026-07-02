import { formatFxDisplayPair } from "@/lib/market-display";

const TOKEN_ICON_BY_SYMBOL = {
  brz: "/tokens/brz.png",
  cngn: "/tokens/cngn.svg",
  eurc: "/tokens/eurc.png",
  usdc: "/tokens/usdc.svg",
  usdt: "/tokens/usdt.svg",
} as const;

export type MarketTokenIcon = {
  src: string;
  symbol: string;
};

export function getMarketTokenIcons(pair: string): MarketTokenIcon[] {
  const [baseSymbol, quoteSymbol] = formatFxDisplayPair(pair).split("/");

  if (!baseSymbol || !quoteSymbol) {
    return [];
  }

  const resolvedIcons: MarketTokenIcon[] = [];

  for (const symbol of [baseSymbol, quoteSymbol]) {
    const src = TOKEN_ICON_BY_SYMBOL[symbol.toLowerCase() as keyof typeof TOKEN_ICON_BY_SYMBOL];

    if (!src) {
      continue;
    }

    resolvedIcons.push({ src, symbol });
  }

  return resolvedIcons;
}
