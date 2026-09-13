import { Duration } from "effect";

const DEFAULT_ATTEMPTS = 10;
const DEFAULT_DELAY_MS = Duration.toMillis("1 second");

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Runs a chain read that has to reflect a transaction the app just confirmed.
 *
 * A receipt proves the block exists somewhere, not that the node serving the next read has it. The
 * RPC sits behind a load balancer, so re-reading a balance straight after a deposit could land on a
 * node a block behind and return the pre-deposit figure — and since nothing re-reads after that, the
 * stale number stayed on screen: account #19 showed 0 cNGN after 7,870 had landed.
 *
 * With `minBlock`, the read waits until the head is at or past it and is pinned to that head, so a
 * lagging node either serves the block or errors and is retried. Without one it is a plain read of
 * latest — one request, exactly as before.
 */
export async function readAtOrAfterBlock<T>({
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  getBlockNumber,
  minBlock,
  read,
  sleep = wait,
}: {
  attempts?: number;
  delayMs?: number;
  /** Must bypass any client-side cache: viem caches the block number for seconds by default. */
  getBlockNumber: () => Promise<bigint>;
  /** The block the read must reflect, e.g. a receipt's; null for a plain read of latest. */
  minBlock: bigint | null;
  /** Performs the read, pinned to `blockNumber` when one is given. */
  read: (blockNumber: bigint | undefined) => Promise<T>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<T> {
  if (minBlock === null) {
    return read(undefined);
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(delayMs);
    }

    try {
      const head = await getBlockNumber();
      if (head < minBlock) {
        lastError = new Error(`RPC head ${head} is behind block ${minBlock}`);
        continue;
      }
      return await read(head);
    } catch (error) {
      // A node without the pinned block rejects the read; the next attempt may reach one that has it.
      lastError = error;
    }
  }

  throw lastError;
}
