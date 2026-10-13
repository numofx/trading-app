/**
 * The one display name per venue market: cNGN is the base, USDC the quote, as the engine trades
 * them. The header, market selector, document title, positions rows and history rows all read it
 * from here, keyed by the venue's market identifier, so no screen invents its own spelling.
 *
 * Since 2026-10-08 the identifier is the display name: `cNGN-USDC` and `cNGN-PERP`. The venue
 * accepts the pre-rename `USDCcNGN-SPOT` / `USDCcNGN-PERP` as deprecated aliases until
 * 2027-01-06, but never emits them, so nothing here needs to know them. A dated future is shown
 * under the venue's own `USDC-cNGN-<DDMONYY>` symbol, which changes every series, so it is not
 * listed here: it is quoted cNGN per USDC, the other way up.
 */
export const MARKET_LABELS = {
  "cNGN-PERP": "cNGN-PERP",
  "cNGN-USDC": "cNGN-USDC",
} as const satisfies Record<string, string>;

/** The display name for a venue symbol, or undefined for one this terminal does not name. */
export function marketLabel(symbol: string | undefined): string | undefined {
  return symbol === undefined ? undefined : (MARKET_LABELS as Record<string, string>)[symbol];
}
