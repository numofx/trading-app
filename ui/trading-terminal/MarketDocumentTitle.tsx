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
 * a second form of the same name. Normalized here so it holds for any caller, whatever
 * separator they pass.
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

    const desiredTitle = `${prefix}${currencySymbol}${formatted} ${formatPairForTitle(pair)} | Numo`;
    prevPriceRef.current = price;

    function applyTitle() {
      if (document.title !== desiredTitle) {
        document.title = desiredTitle;
      }
    }

    applyTitle();

    // Next renders the route's own <title> from `metadata`, and on a fresh load that lands after
    // this effect has already run — discarding it, so the tab read a bare "Numo" until some later
    // prop change happened to re-run the effect. Re-apply whenever the head changes underneath us.
    // Setting the title mutates <title> and re-enters here, but the equality check above makes
    // that a no-op rather than a loop.
    const observer = new MutationObserver(applyTitle);
    observer.observe(document.head, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [pair, price]);

  return null;
}
