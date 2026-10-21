/**
 * The one display name per venue market. The header, market selector, document title, positions
 * rows and history rows all read it from here, keyed by the venue's market identifier, so no screen
 * invents its own spelling.
 *
 * The venue identifies the markets as `cNGN-USDC` and `cNGN-PERP` (since 2026-10-08; the pre-rename
 * `USDCcNGN-SPOT` / `USDCcNGN-PERP` are deprecated aliases until 2027-01-06 that it never emits).
 * Spot is shown as **USDC-cNGN** since 2026-10-14, quoted like the future in cNGN per USDC and sized
 * in USDC (`lib/spot-orientation.ts`); the venue and the engine still trade it as cNGN-USDC. The perp
 * keeps the engine's orientation. A dated future is shown under the venue's own `USDC-cNGN-<DDMONYY>`
 * symbol, which changes every series, so it is not listed here. EURC-USDC is shown as the engine
 * trades it: USDC per EURC, sized in EURC.
 */
export const MARKET_LABELS = {
  "cNGN-PERP": "cNGN-PERP",
  "cNGN-USDC": "USDC-cNGN",
  "EURC-USDC": "EURC-USDC",
} as const satisfies Record<string, string>;

/** The display name for a venue symbol, or undefined for one this terminal does not name. */
export function marketLabel(symbol: string | undefined): string | undefined {
  return symbol === undefined ? undefined : (MARKET_LABELS as Record<string, string>)[symbol];
}
