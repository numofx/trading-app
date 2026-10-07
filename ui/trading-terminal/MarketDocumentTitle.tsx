"use client";

import { useEffect, useRef } from "react";
import { formatPrice } from "@/lib/market-formatting";

/**
 * The app labels markets `cNGN-USDC` everywhere else, so the tab matches rather than introducing
 * a second form of the same name. Normalized here so it holds for any caller, whatever
 * separator they pass.
 */
function formatPairForTitle(pair: string) {
  return pair.replaceAll("/", "-");
}

/**
 * Keeps the tab title on the live price: "↓ 0.0007335 cNGN-USDC | Numo". The price carries no
 * currency sign — it is USDC per cNGN, and the pair label beside it says so.
 */
export function MarketDocumentTitle({ pair, price }: { pair: string; price: number | null }) {
  const prevPriceRef = useRef<number | null>(null);

  useEffect(() => {
    const formatted = price === null ? "--" : formatPrice(price);

    let prefix = "";

    if (price !== null && prevPriceRef.current !== null) {
      if (price > prevPriceRef.current) {
        prefix = "↑ ";
      } else if (price < prevPriceRef.current) {
        prefix = "↓ ";
      }
    }

    const desiredTitle = `${prefix}${formatted} ${formatPairForTitle(pair)} | Numo`;
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
