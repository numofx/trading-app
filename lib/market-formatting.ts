export function calculateBasis(lastPrice: number, spotPrice: number) {
  return lastPrice - spotPrice;
}

export function calculateAnnualizedBasisPercent(
  lastPrice: number,
  spotPrice: number,
  daysToExpiry: number | null
) {
  if (!daysToExpiry || daysToExpiry <= 0 || spotPrice <= 0) {
    return null;
  }

  return (calculateBasis(lastPrice, spotPrice) / spotPrice) * (365 / daysToExpiry) * 100;
}

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

export function formatBasis(value: number | null, digits = 2) {
  if (value === null) {
    return "—";
  }

  const formatted = formatMarketPrice(Math.abs(value), digits);
  let sign = "";

  if (value > 0) {
    sign = "+";
  } else if (value < 0) {
    sign = "-";
  }

  return `${sign}${formatted}`;
}

export function formatAnnualizedBasis(value: number | null, digits = 2) {
  if (value === null) {
    return "—";
  }

  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Math.abs(value));
  let sign = "";

  if (value > 0) {
    sign = "+";
  } else if (value < 0) {
    sign = "-";
  }

  return `${sign}${formatted}%`;
}

/**
 * A signed futures position in contracts.
 *
 * Zero renders as "Flat" rather than "0" because that is the distinction a trader acts on: holding
 * nothing versus carrying a small residual position. Callers must keep null (position unknown)
 * separate from 0 (position known to be flat) — collapsing them tells a trader they are flat when
 * the ledger simply could not be read.
 */
export function formatSignedContracts(value: number) {
  if (value === 0) {
    return "Flat";
  }

  const sign = value > 0 ? "+" : "-";
  const magnitude = Math.abs(value);
  // Positions are multiples of the venue's 0.001 amount step, so 3 decimals is exact. A residual
  // smaller than that should not exist — but if one ever does, rendering it as "0.000" would read
  // as flat, which is the confusion this formatter exists to prevent.
  const digits = magnitude < 0.001 ? 6 : 3;
  const formatted = magnitude.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });

  return `${sign}${formatted} contracts`;
}
