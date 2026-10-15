/**
 * Whether the venue has settled a submitted order yet, and a poll that waits for it to.
 *
 * An order is accepted (HTTP 201) before the matcher has written it to `active_orders` — a few
 * seconds for one that rests. The order book and Open Orders read that same store, so re-rendering
 * the page the instant submission returns fetches a book that does not list the order yet, and
 * nothing retries: the order silently fails to appear until some later render happens to catch it.
 * Polling the per-order status until it reports a real state means the store holds the order before
 * the caller refreshes, so the refresh shows it.
 */

export type OrderOutcome = {
  status?: string;
  filled_amount?: string;
  remaining_amount?: string;
  cancel_reason?: string;
};

/**
 * The states that mean the venue has recorded the order: filled or expired (terminal), cancelled,
 * or active (resting, possibly partially filled). Anything else — a null read, a 404 before the
 * matcher writes it, an absent status — means it is not settled and the poll should keep waiting.
 */
const SETTLED_STATUSES = new Set(["filled", "active", "expired", "cancelled"]);

export function isOrderSettled(outcome: OrderOutcome | null): boolean {
  return outcome?.status != null && SETTLED_STATUSES.has(outcome.status);
}

/**
 * Whether the order's fill, if any, is known: it is done (filled, cancelled, expired), or it rests
 * having filled in part. An order still active with nothing filled may yet cross on the next
 * matcher tick, so a caller waiting for a fill keeps reading.
 */
export function isOrderFillKnown(outcome: OrderOutcome | null): boolean {
  if (!isOrderSettled(outcome)) {
    return false;
  }
  return outcome?.status !== "active" || Number.parseFloat(outcome.filled_amount ?? "0") > 0;
}

/**
 * Reads the order via `read` until it settles (or meets `until`) or `timeoutMs` elapses, waiting
 * `intervalMs` between reads. Returns the last outcome seen — settled if it got there, otherwise whatever the final read
 * returned (possibly null), so the caller can still refresh and report what little is known.
 *
 * `sleep` and `now` are injectable so the poll can be tested without real timers.
 */
export async function pollOrderOutcome(
  read: () => Promise<OrderOutcome | null>,
  {
    intervalMs,
    timeoutMs,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    until = isOrderSettled,
  }: {
    intervalMs: number;
    timeoutMs: number;
    until?: (outcome: OrderOutcome | null) => boolean;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  }
): Promise<OrderOutcome | null> {
  const deadline = now() + timeoutMs;
  let outcome = await read();
  while (!until(outcome) && now() < deadline) {
    await sleep(intervalMs);
    outcome = await read();
  }
  return outcome;
}
