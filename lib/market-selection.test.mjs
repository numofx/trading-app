import { expect, test } from "bun:test";
import {
  buildCanonicalMarketId,
  buildLegacyDerivedMarketId,
  buildMarketSelectionAliasMap,
  CANONICAL_APR_2026_FUTURE_SYMBOL,
  LEGACY_APR_2026_FUTURE_SYMBOL,
  resolveHydratedMarketSelection,
  resolveMarketSelection,
} from "./market-selection.ts";

const canonicalId = buildCanonicalMarketId(
  "0x752803d72c1835cdcd300c7fde6c7d7d2f12e679",
  "1777507200",
);

const aliases = buildMarketSelectionAliasMap([
  {
    contractLabel: "APR 2026",
    expiryDays: 36,
    expiryLabel: "Apr 2026",
    expiryTimestamp: 1777507200,
    flagSrc: "/flags/ng.svg",
    id: canonicalId,
    marketIdAliases: [buildLegacyDerivedMarketId(LEGACY_APR_2026_FUTURE_SYMBOL, "1777507200")],
    marketSymbol: LEGACY_APR_2026_FUTURE_SYMBOL,
    marketSymbolAliases: [CANONICAL_APR_2026_FUTURE_SYMBOL],
    pair: "USDCcNGN",
    region: "Africa",
    sortOrder: 1777507200,
    strikeLabel: null,
    subId: "1777507200",
    type: "future",
  },
]);

test("resolver table maps all known aliases to canonical id", () => {
  expect(resolveMarketSelection(canonicalId, aliases)).toBe(canonicalId);
  expect(resolveMarketSelection(CANONICAL_APR_2026_FUTURE_SYMBOL, aliases)).toBe(canonicalId);
  expect(resolveMarketSelection(LEGACY_APR_2026_FUTURE_SYMBOL, aliases)).toBe(canonicalId);
  expect(resolveMarketSelection(buildLegacyDerivedMarketId(LEGACY_APR_2026_FUTURE_SYMBOL, "1777507200"), aliases)).toBe(
    canonicalId,
  );
  expect(resolveMarketSelection("totally-unknown-market", aliases)).toBeNull();
});

test("hydration uses valid query param over stored selection", () => {
  const resolution = resolveHydratedMarketSelection({
    aliases,
    defaultMarketId: "cngn-usdc-spot",
    requestedMarket: LEGACY_APR_2026_FUTURE_SYMBOL,
    storedMarket: "cngn-usdc-spot",
  });

  expect(resolution.shouldIgnoreInvalidRequestedMarket).toBe(false);
  expect(resolution.selectedMarketId).toBe(canonicalId);
});

test("hydration ignores invalid query param without overwriting stored selection", () => {
  const resolution = resolveHydratedMarketSelection({
    aliases,
    defaultMarketId: "cngn-usdc-spot",
    requestedMarket: "totally-unknown-market",
    storedMarket: canonicalId,
  });

  expect(resolution.shouldIgnoreInvalidRequestedMarket).toBe(true);
  expect(resolution.selectedMarketId).toBeNull();
});
