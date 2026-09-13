import { expect, test } from "bun:test";
import {
  buildSubaccountCacheKey,
  parseSubaccountCache,
  resolveScanFloor,
  serializeSubaccountCache,
} from "./trading-subaccount-cache.ts";

const FLOOR = 48_833_365n;
const MARGIN = 2000n;

const KEY_PARTS = {
  chainId: 8453,
  managerAddress: "0x3195Bd7e02d93982bCF8b34DF5B941fFCaE1E49b",
  matchingAddress: "0x9E90A9cD13d859Bd6a08168082FB1F6F7405F191",
  ownerAddress: "0x3448AC0A3283951A2AFD5B3A582329ECA43CB47B",
};

test("cache key is scoped to chain, deployment, manager and owner", () => {
  const key = buildSubaccountCacheKey(KEY_PARTS);

  expect(key).toContain("8453");
  expect(key).toContain("0x9e90a9cd13d859bd6a08168082fb1f6f7405f191");
  expect(key).toContain("0x3195bd7e02d93982bcf8b34df5b941ffcae1e49b");
  expect(key).toContain("0x3448ac0a3283951a2afd5b3a582329eca43cb47b");

  // A subaccount id only means something against one deployment, so a different Matching address
  // or chain must not reuse the entry.
  const otherChain = buildSubaccountCacheKey({ ...KEY_PARTS, chainId: 84_532 });
  const otherMatching = buildSubaccountCacheKey({
    ...KEY_PARTS,
    matchingAddress: "0x0000000000000000000000000000000000000001",
  });
  expect(otherChain).not.toBe(key);
  expect(otherMatching).not.toBe(key);
});

/**
 * The 2026-09-10 move to the SRM: wallets that cached an account under DeliverableFXManager must
 * not keep resolving it, because that account can never settle a trade again.
 */
test("a different manager does not reuse the entry", () => {
  const underRetiredManager = buildSubaccountCacheKey({
    ...KEY_PARTS,
    managerAddress: "0xcE01f3D74400caE39bd7608cd2d286C2e3874d49",
  });

  expect(underRetiredManager).not.toBe(buildSubaccountCacheKey(KEY_PARTS));
});

test("no cache scans the full range from the deployment floor", () => {
  const floor = resolveScanFloor({
    cached: null,
    floorBlock: FLOOR,
    latestBlock: 49_668_349n,
    reorgMargin: MARGIN,
  });
  expect(floor).toBe(FLOOR);
});

test("a cached result resumes from the last scanned block, less a reorg margin", () => {
  const floor = resolveScanFloor({
    cached: { scannedToBlock: "49668349", subaccountId: "9" },
    floorBlock: FLOOR,
    latestBlock: 49_670_000n,
    reorgMargin: MARGIN,
  });

  expect(floor).toBe(49_668_349n - MARGIN);
  // The point of the fix: a repeat visit scans thousands of blocks, not ~800k.
  expect(49_670_000n - floor).toBeLessThan(10_000n);
});

test("the resume point never drops below the deployment floor", () => {
  const floor = resolveScanFloor({
    cached: { scannedToBlock: String(FLOOR + 10n), subaccountId: null },
    floorBlock: FLOOR,
    latestBlock: FLOOR + 100n,
    reorgMargin: MARGIN,
  });
  expect(floor).toBe(FLOOR);
});

// A cache written against a longer chain describes a different network. Trusting it would skip
// the range entirely and report "no subaccount" for a wallet that has one.
test("a cache ahead of the chain head is discarded", () => {
  const floor = resolveScanFloor({
    cached: { scannedToBlock: "99999999", subaccountId: "9" },
    floorBlock: FLOOR,
    latestBlock: 49_668_349n,
    reorgMargin: MARGIN,
  });
  expect(floor).toBe(FLOOR);
});

test("round-trips a resolved subaccount and a proven absence", () => {
  for (const value of [
    { scannedToBlock: "49668349", subaccountId: "9" },
    { scannedToBlock: "49668349", subaccountId: null },
  ]) {
    expect(parseSubaccountCache(serializeSubaccountCache(value))).toEqual(value);
  }
});

test("malformed entries are ignored rather than trusted", () => {
  for (const raw of [
    null,
    "",
    "not json",
    "{}",
    '{"subaccountId":"9"}',
    '{"scannedToBlock":49668349,"subaccountId":"9"}',
    '{"scannedToBlock":"not-a-number","subaccountId":"9"}',
    '{"scannedToBlock":"49668349","subaccountId":7}',
    "[]",
    "null",
  ]) {
    expect(parseSubaccountCache(raw)).toBeNull();
  }
});
