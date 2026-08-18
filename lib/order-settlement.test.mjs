import { expect, test } from "bun:test";
import { isOrderSettled, pollOrderOutcome } from "./order-settlement.ts";

test("isOrderSettled recognizes the recorded states and nothing else", () => {
  for (const status of ["filled", "active", "expired", "cancelled"]) {
    expect(isOrderSettled({ status })).toBe(true);
  }
  expect(isOrderSettled(null)).toBe(false);
  expect(isOrderSettled({})).toBe(false);
  // A 404-before-the-matcher-writes-it reads as null; an unknown status is not settled either.
  expect(isOrderSettled({ status: "pending" })).toBe(false);
});

/*
 * The order is accepted before it lands in active_orders, so the first reads come back empty. The
 * poll must keep going until the venue reports a real state, then stop — that is what lets the
 * caller refresh a book that actually lists the order.
 */
test("pollOrderOutcome waits until the order is recorded, then stops", async () => {
  const reads = [null, null, { filled_amount: "0", status: "active" }];
  let index = 0;
  let clock = 0;
  const slept = [];

  const outcome = await pollOrderOutcome(() => Promise.resolve(reads[Math.min(index++, reads.length - 1)]), {
    intervalMs: 1000,
    now: () => clock,
    sleep: (ms) => {
      slept.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    timeoutMs: 8000,
  });

  expect(outcome?.status).toBe("active");
  expect(index).toBe(3); // three reads
  expect(slept).toEqual([1000, 1000]); // two waits between them
});

test("pollOrderOutcome gives up at the timeout and returns the last read", async () => {
  let clock = 0;
  let reads = 0;

  const outcome = await pollOrderOutcome(
    () => {
      reads += 1;
      return Promise.resolve(null);
    },
    {
      intervalMs: 1000,
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      timeoutMs: 3000,
    }
  );

  expect(outcome).toBeNull();
  // Reads at t=0,1000,2000,3000; the loop stops once now() reaches the 3000 deadline.
  expect(reads).toBe(4);
});

test("pollOrderOutcome never sleeps when the first read is already settled", async () => {
  let slept = false;
  const outcome = await pollOrderOutcome(() => Promise.resolve({ status: "filled" }), {
    intervalMs: 1000,
    now: () => 0,
    sleep: () => {
      slept = true;
      return Promise.resolve();
    },
    timeoutMs: 8000,
  });
  expect(outcome?.status).toBe("filled");
  expect(slept).toBe(false);
});
