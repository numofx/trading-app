import { expect, test } from "bun:test";
import { base, baseSepolia } from "viem/chains";
import { getExplorerTransactionUrl } from "./explorer-links.ts";

/** The first live signed withdrawal, 2026-09-14 13:25:50Z. */
const WITHDRAWAL_TX = "0xffff17a9814e32bedd2bcdeffb214dc1293bac59d634560af73200293a5e0175";

test("a transaction links to Basescan on the app's chain", () => {
  expect(getExplorerTransactionUrl(WITHDRAWAL_TX, base.blockExplorers.default.url)).toBe(
    `https://basescan.org/tx/${WITHDRAWAL_TX}`
  );
  expect(getExplorerTransactionUrl(WITHDRAWAL_TX, baseSepolia.blockExplorers.default.url)).toBe(
    `https://sepolia.basescan.org/tx/${WITHDRAWAL_TX}`
  );
  expect(getExplorerTransactionUrl(WITHDRAWAL_TX, "https://basescan.org/")).toBe(
    `https://basescan.org/tx/${WITHDRAWAL_TX}`
  );
});

test("nothing that is not a transaction hash becomes a link", () => {
  for (const txHash of [undefined, "", "dry-run", "0x1234", "javascript:alert(1)", `${WITHDRAWAL_TX}00`]) {
    expect(getExplorerTransactionUrl(txHash, base.blockExplorers.default.url)).toBeNull();
  }
  expect(getExplorerTransactionUrl(WITHDRAWAL_TX, undefined)).toBeNull();
});
