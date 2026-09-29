import { expect, test } from "bun:test";
import { withGasHeadroom } from "./gas-headroom.ts";

test("covers the perp cash accrual a block after the estimate", () => {
  // Measured on a Base fork: 122,902 gas estimated on the touching block, 181,787 a block later.
  expect(withGasHeadroom(122_902n) >= 181_787n).toBe(true);
});

test("adds at least 100k on small calls, and 50% on large ones", () => {
  expect(withGasHeadroom(60_000n)).toBe(160_000n);
  expect(withGasHeadroom(1_000_000n)).toBe(1_500_000n);
});
