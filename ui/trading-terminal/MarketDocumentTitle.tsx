"use client";

import { useEffect, useRef } from "react";

function getCurrencySymbol(pair: string) {
  if (pair.includes("EURC") || pair.includes("EUR")) {
    return "€";
  }
  if (pair.includes("cNGN") || pair.includes("NGN")) {
    return "₦";
  }
  if (pair.includes("BRZ")) {
    return "R$";
  }
  return "$";
}

/**
 * The app labels markets `USDC-cNGN` everywhere else, so the tab matches rather than introducing
 * a second form of the same name. Normalized here so it holds for both sections and any future
 * caller, whatever separator they pass.
 */
function formatPairForTitle(pair: string) {
  return pair.replaceAll("/", "-");
}

function getPrecisionDigits(pair: string) {
  return pair.includes("EURC") || pair.includes("EUR") || pair.includes("BRZ") ? 4 : 2;
}

function formatPrice(price: number | null, pair: string) {
  if (price === null) {
    return "--";
  }
  const digits = getPrecisionDigits(pair);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(price);
}

export function MarketDocumentTitle({ pair, price }: { pair: string; price: number | null }) {
  const prevPriceRef = useRef<number | null>(null);

  useEffect(() => {
    const currencySymbol = getCurrencySymbol(pair);
    const formatted = formatPrice(price, pair);

    let prefix = "";

    if (price !== null && prevPriceRef.current !== null) {
      if (price > prevPriceRef.current) {
        prefix = "↑ ";
      } else if (price < prevPriceRef.current) {
        prefix = "↓ ";
      }
    }

    document.title = `${prefix}${currencySymbol}${formatted} ${formatPairForTitle(pair)} | Numo`;

    prevPriceRef.current = price;
  }, [pair, price]);

  return null;
}
