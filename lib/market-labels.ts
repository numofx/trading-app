/**
 * The one display name per venue market: cNGN is the base, USDC the quote, as the engine trades
 * them. The header, market selector, document title, positions rows and history rows all read it
 * from here, keyed by the venue's internal symbol (which stays USDCcNGN-* on the wire), so no
 * screen invents its own spelling.
 */
export const MARKET_LABELS = {
  "USDCcNGN-PERP": "cNGN-PERP",
  "USDCcNGN-SPOT": "cNGN-USDC",
} as const satisfies Record<string, string>;

/** The display name for a venue symbol, or undefined for one this terminal does not name. */
export function marketLabel(symbol: string | undefined): string | undefined {
  return symbol === undefined ? undefined : (MARKET_LABELS as Record<string, string>)[symbol];
}
