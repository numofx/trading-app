/**
 * The order-entry contracts markets-service accepts a `ui_intent` under. Both are identity
 * mappings: the UI's side, price (USDC per cNGN) and size (cNGN) are the engine's own, so nothing
 * on screen is inverted. The spec still travels with every order so the venue can refuse an
 * intent signed for the other market.
 */
export const SPOT_ORDER_ENTRY_SPEC = "cngn_usdc_spot_v1";
export const PERP_ORDER_ENTRY_SPEC = "cngn_usdc_perp_v1";
