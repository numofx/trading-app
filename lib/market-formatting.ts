export function calculateBasis(lastPrice: number, spotPrice: number) {
  return lastPrice - spotPrice;
}

export function calculateAnnualizedBasisPercent(
  lastPrice: number,
  spotPrice: number,
  daysToExpiry: number | null,
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
