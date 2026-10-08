import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MARKET_SLUGS, marketIdForSlug, marketPath, resolveMarketSlug } from "./market-routes.ts";

test("each market has a lowercase slug under /trade", () => {
  expect(MARKET_SLUGS).toEqual({ perp: "cngn-perp", spot: "cngn-usdc" });
  expect(marketPath("spot")).toBe("/trade/cngn-usdc");
  expect(marketPath("perp")).toBe("/trade/cngn-perp");
  for (const slug of Object.values(MARKET_SLUGS)) {
    expect(slug).toBe(slug.toLowerCase());
  }
});

test("a canonical slug resolves to its market; another casing redirects to it with the query kept", () => {
  expect(resolveMarketSlug("cngn-usdc")).toEqual({ id: "spot" });
  expect(resolveMarketSlug("cngn-perp")).toEqual({ id: "perp" });
  expect(resolveMarketSlug("cNGN-USDC")).toEqual({ redirect: "/trade/cngn-usdc" });
  expect(resolveMarketSlug("CNGN-PERP", "?ref=x")).toEqual({ redirect: "/trade/cngn-perp?ref=x" });
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
});

test("next.config redirects the old routes onto the same slugs", () => {
  const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  expect(config).toContain(`destination: "${marketPath("spot")}"`);
  expect(config).toContain(`destination: "${marketPath("perp")}"`);
  // 307 until the slugs are final; a 308 is cached by browsers for good.
  expect(config).not.toContain("permanent: true");
});
