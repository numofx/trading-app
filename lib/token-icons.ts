/** The terminal's token marks, by ticker, as served from `public/tokens`. */
export const TOKEN_ICONS = {
  cNGN: "/tokens/cngn.svg",
  USDC: "/tokens/usdc.svg",
} as const satisfies Record<string, string>;

export type TokenIconSymbol = keyof typeof TOKEN_ICONS;

/** A ticker's mark, or nothing for one the terminal has no mark for. */
export function tokenIcon(symbol: string): string | undefined {
  return symbol in TOKEN_ICONS ? TOKEN_ICONS[symbol as TokenIconSymbol] : undefined;
}
