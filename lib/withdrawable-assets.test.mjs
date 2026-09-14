import { expect, test } from "bun:test";
import {
  findSiblingAssetWithBalance,
  findWithdrawableAsset,
  getAssetLedgerUnits,
  getWithdrawableAssets,
} from "./withdrawable-assets.ts";

const BASE_MAINNET_CHAIN_ID = "8453";
const BASE_SEPOLIA_CHAIN_ID = "84532";

/** The legacy USDC CashAsset: its ledger claims exceed the USDC it holds, so it cannot pay out. */
const LEGACY_CASH_ASSET = "0x6B232A2155Bd0C9bf741dB4cf8E7e8A0176A6fc6";

function withChain(chainId, run) {
  const previous = process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID;
  process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID = chainId;

  try {
    run();
  } finally {
    process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID = previous;
  }
}

test("mainnet offers the settling USDC escrow and cNGN, in that order", () => {
  withChain(BASE_MAINNET_CHAIN_ID, () => {
    const assets = getWithdrawableAssets();

    expect(assets.map((asset) => asset.id)).toEqual(["usdc", "cngn"]);
    expect(assets[0].escrow).toBe("0x364058aFF6f36E01505fB2Cc870f8B6BD4835e84");
    expect(assets[0].token).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(assets[1].escrow).toBe("0x9D806fD040a719D27a8E5E77dc5aE0ED1e089493");
  });
});

/** A "Legacy USDC" row at 0 for nearly every account, on an escrow that cannot pay, helped no one. */
test("the legacy USDC CashAsset is not offered on any chain", () => {
  for (const chainId of [BASE_MAINNET_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID]) {
    withChain(chainId, () => {
      const assets = getWithdrawableAssets();

      expect(assets.map((asset) => asset.label)).not.toContain("Legacy USDC");
      expect(assets.map((asset) => asset.escrow.toLowerCase())).not.toContain(
        LEGACY_CASH_ASSET.toLowerCase()
      );
      expect(assets.filter((asset) => asset.symbol === "USDC")).toHaveLength(1);
    });
  }
});

test("Sepolia offers the same two assets", () => {
  withChain(BASE_SEPOLIA_CHAIN_ID, () => {
    expect(getWithdrawableAssets().map((asset) => asset.id)).toEqual(["usdc", "cngn"]);
  });
});

test("assets are addressable by id, and the retired ids resolve to nothing", () => {
  withChain(BASE_MAINNET_CHAIN_ID, () => {
    expect(findWithdrawableAsset("usdc")?.label).toBe("USDC");
    expect(findWithdrawableAsset("usdc-cash")).toBeNull();
    expect(findWithdrawableAsset("usdc-wrapped")).toBeNull();
    expect(findWithdrawableAsset("nope")).toBeNull();
  });
});

/** Account #11's real ledger rows: the ledger still reports the legacy escrow, even though it is not offered. */
const ROWS = [
  { asset: "0x364058aFF6f36E01505fB2Cc870f8B6BD4835e84", balance: 5_000_000_000_000_000_000n },
  { asset: LEGACY_CASH_ASSET, balance: 3_942_881_792_831_387_705n },
];

test("a balance is matched to its escrow regardless of address casing", () => {
  expect(getAssetLedgerUnits(ROWS, "0x364058aff6f36e01505fb2cc870f8b6bd4835e84")).toBe(
    5_000_000_000_000_000_000n
  );
  expect(getAssetLedgerUnits(ROWS, LEGACY_CASH_ASSET)).toBe(3_942_881_792_831_387_705n);
});

/** An asset the account simply does not hold is zero; an unread ledger is not. */
test("an absent row is zero, an unread ledger is null", () => {
  expect(getAssetLedgerUnits(ROWS, "0x9D806fD040a719D27a8E5E77dc5aE0ED1e089493")).toBe(0n);
  expect(getAssetLedgerUnits(null, "0x9D806fD040a719D27a8E5E77dc5aE0ED1e089493")).toBeNull();
});

test("with one escrow per ticker, no sibling is ever offered", () => {
  withChain(BASE_MAINNET_CHAIN_ID, () => {
    const assets = getWithdrawableAssets();

    for (const current of assets) {
      expect(findSiblingAssetWithBalance({ assets, current, rows: ROWS })).toBeNull();
    }
  });
});

/** The helper itself, for a list that names two escrows for one ticker. */
const TWO_USDC_ESCROWS = [
  { escrow: LEGACY_CASH_ASSET, id: "usdc-a", label: "USDC A", symbol: "USDC", token: "0xT" },
  {
    escrow: "0x364058aFF6f36E01505fB2Cc870f8B6BD4835e84",
    id: "usdc-b",
    label: "USDC B",
    symbol: "USDC",
    token: "0xT",
  },
  {
    escrow: "0x9D806fD040a719D27a8E5E77dc5aE0ED1e089493",
    id: "cngn",
    label: "cNGN",
    symbol: "cNGN",
    token: "0xC",
  },
];

test("given two escrows for a ticker, a blocked one points at the other holding a balance", () => {
  const [first, second, cngn] = TWO_USDC_ESCROWS;

  expect(findSiblingAssetWithBalance({ assets: TWO_USDC_ESCROWS, current: first, rows: ROWS })?.id).toBe(
    second.id
  );
  // Never across tickers.
  expect(findSiblingAssetWithBalance({ assets: TWO_USDC_ESCROWS, current: cngn, rows: ROWS })).toBeNull();
  // And an empty sibling is not worth suggesting.
  expect(
    findSiblingAssetWithBalance({ assets: TWO_USDC_ESCROWS, current: first, rows: [ROWS[1]] })
  ).toBeNull();
});
