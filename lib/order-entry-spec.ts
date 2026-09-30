/**
 * The order-entry contracts whose engine values are inverted for display: price in cNGN per USDC
 * (1 / engine price), size in USDC notional, side flipped. markets-service sets `order_entry_spec`
 * only for these; every other market presents engine values directly.
 *
 * Spot and the perp share the translation because both are quoted in USD per cNGN/NGN on chain.
 */
export const SPOT_ORDER_ENTRY_SPEC = "usdc_cngn_spot_v1";
export const PERP_ORDER_ENTRY_SPEC = "usdc_cngn_perp_v1";

const INVERTED_ORDER_ENTRY_SPECS: ReadonlySet<string> = new Set([
  SPOT_ORDER_ENTRY_SPEC,
  PERP_ORDER_ENTRY_SPEC,
]);

/** Whether a market's engine values need the USDC/cNGN inversion. Keyed on the spec, never the type. */
export function isInvertedOrderEntrySpec(spec: string | null | undefined): boolean {
  return spec !== null && spec !== undefined && INVERTED_ORDER_ENTRY_SPECS.has(spec);
}
