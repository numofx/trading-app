export function formatMarketPrice(value: number | null, digits = 2) {
  if (value === null) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function formatNaira(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return `₦${formatMarketPrice(value, digits)}`;
}
