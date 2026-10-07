/**
 * The decimals a USDC-per-cNGN price is shown to. At about 0.00073 USDC per cNGN, seven places
 * resolve a tenth of a basis point (one unit is 0.14 bps), which is finer than the market maker's
 * step; the engine's own tick is 1e-18, so the ladder never has to round a resting level.
 */
export const PRICE_DECIMALS = 7;

export function formatMarketPrice(value: number | null, digits = 2) {
  if (value === null) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

/** A USDC-per-cNGN price, e.g. "0.0007337"; an em dash when unknown. No unit: the column names it. */
export function formatPrice(value: number | null, digits = PRICE_DECIMALS) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return formatMarketPrice(value, digits);
}

/** A USDC-per-cNGN price with its unit, where no column names it: "0.0007337 USDC". */
export function formatUsdcPrice(value: number | null, digits = PRICE_DECIMALS) {
  const price = formatPrice(value, digits);
  return price === "—" ? price : `${price} USDC`;
}

/** The same price the other way up, cNGN per USDC, for the secondary ₦ line; null when unknown. */
export function toNairaPerUsdc(price: number | null) {
  return price === null || !Number.isFinite(price) || price <= 0 ? null : 1 / price;
}

/** A naira amount, e.g. "₦1,363.31": the secondary reading of a price, or a cNGN figure. */
export function formatNaira(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return `₦${formatMarketPrice(value, digits)}`;
}

/** The secondary line under a USDC-per-cNGN price: "₦1,363.31 per USDC"; an em dash when unknown. */
export function formatNairaPerUsdc(price: number | null) {
  const naira = toNairaPerUsdc(price);
  return naira === null ? "—" : `${formatNaira(naira)} per USDC`;
}
