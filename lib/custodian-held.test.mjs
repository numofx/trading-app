import { expect, test } from "bun:test";
import {
  blockWindows,
  custodianDeployBlock,
  EXIT_LOG_CHUNK_BLOCKS,
  walletHeldAccounts,
} from "./custodian-held.ts";

const WALLET = "0xeaBca823B4d35d8F2eac09edB55C42D8077fbFcA";
const ENGINE = "0x0705219a1594d5Fc5dC2573da4082cAf3e1B0950";
const OTHER = "0x000000000000000000000000000000000000dEaD";

test("windows cover the range exactly, none wider than the chunk", () => {
  expect(blockWindows(10n, 25n, 10n)).toEqual([
    [10n, 19n],
    [20n, 25n],
  ]);
  expect(blockWindows(10n, 19n, 10n)).toEqual([[10n, 19n]]);
  expect(blockWindows(10n, 10n, 10n)).toEqual([[10n, 10n]]);
  expect(blockWindows(11n, 10n, 10n)).toEqual([]);
  for (const [from, to] of blockWindows(59_581_388n, 59_700_000n, EXIT_LOG_CHUNK_BLOCKS)) {
    expect(to - from + 1n <= EXIT_LOG_CHUNK_BLOCKS).toBe(true);
  }
});

test("only Base has a custodian to scan", () => {
  expect(custodianDeployBlock(8453)).toBe(59_581_388n);
  expect(custodianDeployBlock(84_532)).toBeNull();
});

test("an exited account shows while the wallet still holds it under the series' engine with cash", () => {
  const held = { accountId: 63n, cashUnits: 10n * 10n ** 18n, manager: ENGINE, owner: WALLET };
  expect(walletHeldAccounts([held], WALLET.toLowerCase(), ENGINE)).toEqual([
    { accountId: "63", cashUnits: 10n * 10n ** 18n },
  ]);
  // passed on to someone else, another engine, emptied, or listed twice
  expect(walletHeldAccounts([{ ...held, owner: OTHER }], WALLET, ENGINE)).toEqual([]);
  expect(walletHeldAccounts([{ ...held, manager: OTHER }], WALLET, ENGINE)).toEqual([]);
  expect(walletHeldAccounts([{ ...held, cashUnits: 0n }], WALLET, ENGINE)).toEqual([]);
  // #63 after its exit: 2.37e9 wei, under a cent
  expect(walletHeldAccounts([{ ...held, cashUnits: 2_370_000_000n }], WALLET, ENGINE)).toEqual([]);
  expect(walletHeldAccounts([held, held], WALLET, ENGINE)).toHaveLength(1);
});
