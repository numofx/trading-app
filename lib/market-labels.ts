/**
 * The one display name per venue market. The header, market selector, document title, positions
 * rows and history rows all read it from here, keyed by the symbol markets-service labels rows
 * with, so no screen invents its own spelling (the venue's `display_name` is "USDC/cNGN
 * Perpetual", which the header never showed).
 */
export const MARKET_LABELS = {
  "USDCcNGN-PERP": "USDC-cNGN-PERP",
  "USDCcNGN-SPOT": "USDC-cNGN",
} as const satisfies Record<string, string>;

/** The display name for a venue symbol, or undefined for one this terminal does not name. */
export function marketLabel(symbol: string | undefined): string | undefined {
  return symbol === undefined ? undefined : (MARKET_LABELS as Record<string, string>)[symbol];
}
