import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  futurePath,
  futureSymbolForSlug,
  MARKET_SLUGS,
  marketIdForSlug,
  marketPath,
  resolveMarketSlug,
} from "./market-routes.ts";

const REDIRECT_ENTRY = /destination: "([^"]+)", permanent: (\w+), source: "([^"]+)"/g;

test("the spot pairs and the perp have fixed lowercase slugs under /trade", () => {
  expect(MARKET_SLUGS).toEqual({ eurc: "eurc-usdc", perp: "cngn-perp", spot: "cngn-usdc" });
  expect(marketPath("spot")).toBe("/trade/cngn-usdc");
  expect(marketPath("eurc")).toBe("/trade/eurc-usdc");
  expect(marketPath("perp")).toBe("/trade/cngn-perp");
  for (const slug of Object.values(MARKET_SLUGS)) {
    expect(slug).toBe(slug.toLowerCase());
  }
});

test("a future series lives at its venue symbol lowercased, so a new series is a new URL with no code change", () => {
  expect(futurePath("USDC-cNGN-30NOV26")).toBe("/trade/usdc-cngn-30nov26");
  expect(futurePath("USDC-cNGN-31DEC26")).toBe("/trade/usdc-cngn-31dec26");
  expect(futureSymbolForSlug("usdc-cngn-30nov26")).toBe("USDC-cNGN-30NOV26");
  expect(futureSymbolForSlug("usdc-cngn-31dec26")).toBe("USDC-cNGN-31DEC26");
  expect(futureSymbolForSlug("usdc-cngn-perp")).toBeNull();
  expect(futureSymbolForSlug("usdc-cngn-3nov26")).toBeNull();
});

test("a canonical slug resolves to its market; another casing redirects to it with the query kept", () => {
  expect(resolveMarketSlug("cngn-usdc")).toEqual({ id: "spot" });
  expect(resolveMarketSlug("cngn-perp")).toEqual({ id: "perp" });
  expect(resolveMarketSlug("eurc-usdc")).toEqual({ id: "eurc" });
  expect(resolveMarketSlug("EURC-USDC")).toEqual({ redirect: "/trade/eurc-usdc" });
  expect(resolveMarketSlug("cNGN-USDC")).toEqual({ redirect: "/trade/cngn-usdc" });
  expect(resolveMarketSlug("CNGN-PERP", "?ref=x")).toEqual({ redirect: "/trade/cngn-perp?ref=x" });
  expect(resolveMarketSlug("usdc-cngn-30nov26")).toEqual({
    id: "future",
    symbol: "USDC-cNGN-30NOV26",
  });
  expect(resolveMarketSlug("USDC-cNGN-30NOV26", "?a=1")).toEqual({
    redirect: "/trade/usdc-cngn-30nov26?a=1",
  });
});

test("an unknown slug is a 404, not a fallback to spot", () => {
  expect(resolveMarketSlug("btc-usdc")).toBeNull();
  expect(resolveMarketSlug("")).toBeNull();
  expect(resolveMarketSlug("perp")).toBeNull();
  expect(marketIdForSlug("btc-usdc")).toBeNull();
  expect(marketIdForSlug(null)).toBeNull();
  // The segment reader takes the slug as the URL has it: a casing the page is about to redirect
  // is not yet a market.
  expect(marketIdForSlug("cNGN-USDC")).toBeNull();
  expect(marketIdForSlug("cngn-perp")).toBe("perp");
  expect(marketIdForSlug("usdc-cngn-30nov26")).toBe("future");
});

test("next.config redirects nothing: / is chosen per request, and /perp went with the perp's delisting", () => {
  const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  const redirects = Object.fromEntries(
    [...config.matchAll(REDIRECT_ENTRY)].map(([, destination, permanent, source]) => [
      source,
      { destination, permanent },
    ])
  );
  expect(redirects).toEqual({});
});
