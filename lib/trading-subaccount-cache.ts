import "client-only";

/**
 * Persistence for the trading-subaccount lookup.
 *
 * Resolving a wallet's subaccount means scanning `DepositedSubAccount` logs, and there is no
 * reverse mapping on-chain to ask instead. The scan walks back from the chain head to the
 * Matching deployment in 2000-block windows — one `eth_getLogs` per window — so its cost grows
 * every day the chain advances. A wallet with no subaccount is the worst case: it scans the
 * entire range to prove the absence, and the submit button stays disabled for the duration.
 *
 * Caching the result, and the block it was accurate as of, turns every later visit into a scan
 * of only the blocks produced since.
 */

/** Bumped when the shape changes, so old entries are ignored rather than mis-parsed. */
const CACHE_VERSION = "v1";
const CACHE_PREFIX = "numo.trading-subaccount";
const BLOCK_NUMBER_PATTERN = /^\d+$/;

export type SubaccountScanCache = {
  /** The resolved subaccount, or null when the scan proved there was none. */
  subaccountId: string | null;
  /** Highest block this result accounts for, as a base-10 string. */
  scannedToBlock: string;
};

/**
 * Cache identity. The chain and Matching address are part of the key because a subaccount id is
 * only meaningful against one deployment — pointing the app at another must not reuse this.
 */
export function buildSubaccountCacheKey({
  chainId,
  matchingAddress,
  ownerAddress,
}: {
  chainId: number;
  matchingAddress: string;
  ownerAddress: string;
}) {
  return [
    CACHE_PREFIX,
    CACHE_VERSION,
    String(chainId),
    matchingAddress.toLowerCase(),
    ownerAddress.toLowerCase(),
  ].join(".");
}

/** Parses a stored entry, returning null for anything malformed rather than throwing. */
export function parseSubaccountCache(raw: string | null): SubaccountScanCache | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const { scannedToBlock, subaccountId } = parsed as Record<string, unknown>;
    if (typeof scannedToBlock !== "string" || !BLOCK_NUMBER_PATTERN.test(scannedToBlock)) {
      return null;
    }
    if (subaccountId !== null && typeof subaccountId !== "string") {
      return null;
    }

    return { scannedToBlock, subaccountId };
  } catch {
    return null;
  }
}

export function serializeSubaccountCache(value: SubaccountScanCache) {
  return JSON.stringify(value);
}

/**
 * Where the next scan should start, given a cached result.
 *
 * Re-scans a margin of already-scanned blocks so a reorg near the previous head cannot drop an
 * event. Never returns a block below `floorBlock`, and never above `latestBlock` — a cache
 * written against a longer chain (or a different network) must not skip the range entirely.
 */
export function resolveScanFloor({
  cached,
  floorBlock,
  latestBlock,
  reorgMargin,
}: {
  cached: SubaccountScanCache | null;
  floorBlock: bigint;
  latestBlock: bigint;
  reorgMargin: bigint;
}) {
  if (!cached) {
    return floorBlock;
  }

  const scannedTo = BigInt(cached.scannedToBlock);
  if (scannedTo > latestBlock) {
    // The cache is ahead of the chain we are talking to, so it describes a different one.
    return floorBlock;
  }

  const resume = scannedTo - reorgMargin;
  return resume > floorBlock ? resume : floorBlock;
}

export function readSubaccountCache(key: string): SubaccountScanCache | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return parseSubaccountCache(window.localStorage.getItem(key));
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Losing the cache only costs
    // a rescan, so it must never break the lookup.
    return null;
  }
}

export function writeSubaccountCache(key: string, value: SubaccountScanCache) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, serializeSubaccountCache(value));
  } catch {
    // Quota or blocked storage — same reasoning as above.
  }
}
