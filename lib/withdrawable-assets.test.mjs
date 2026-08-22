import { expect, test } from "bun:test";
import {
  findSiblingAssetWithBalance,
  findWithdrawableAsset,
  getAssetLedgerUnits,
  getWithdrawableAssets,
} from "./withdrawable-assets.ts";

const BASE_MAINNET_CHAIN_ID = "8453";
const BASE_SEPOLIA_CHAIN_ID = "84532";

function withChain(chainId, run) {
  const previous = process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID;
  process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID = chainId;

  try {
    run();
  } finally {
    process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID = previous;
  }
}

/**
 * The whole point of the list: mainnet holds USDC in two unrelated escrows. Account #11 held 3.94
 * in the CashAsset and 5.00 in the wrapped one, and only the second was actually backed — so a
 * list with one USDC entry hides real, withdrawable money.
 */
test("mainnet offers both USDC escrows plus cNGN", () => {
  withChain(BASE_MAINNET_CHAIN_ID, () => {
    const assets = getWithdrawableAssets();

    expect(assets.map((asset) => asset.id)).toEqual(["usdc-cash", "usdc-wrapped", "cngn"]);
    expect(assets[0].escrow).toBe("0x6B232A2155Bd0C9bf741dB4cf8E7e8A0176A6fc6");
    expect(assets[1].escrow).toBe("0x364058aFF6f36E01505fB2Cc870f8B6BD4835e84");
    expect(assets[2].escrow).toBe("0x9D806fD040a719D27a8E5E77dc5aE0ED1e089493");
  });
});

/** Both USDC rows pay out the same ERC-20; only the escrow holding the claim differs. */
test("the two USDC escrows share one token", () => {
  withChain(BASE_MAINNET_CHAIN_ID, () => {
    const [cash, wrapped] = getWithdrawableAssets();

    expect(cash.token).toBe(wrapped.token);
    expect(cash.token).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(cash.escrow).not.toBe(wrapped.escrow);
    expect(cash.label).not.toBe(wrapped.label);
  });
});

test("Sepolia has no second USDC escrow to offer", () => {
  withChain(BASE_SEPOLIA_CHAIN_ID, () => {
    expect(getWithdrawableAssets().map((asset) => asset.id)).toEqual(["usdc", "cngn"]);
  });
});

test("assets are addressable by id", () => {
  withChain(BASE_MAINNET_CHAIN_ID, () => {
    expect(findWithdrawableAsset("usdc-wrapped")?.label).toBe("Wrapped USDC");
    expect(findWithdrawableAsset("nope")).toBeNull();
  });
});

/** Account #11's real ledger rows. */
const ROWS = [
  { asset: "0x364058aFF6f36E01505fB2Cc870f8B6BD4835e84", balance: 5_000_000_000_000_000_000n },
  { asset: "0x6B232A2155Bd0C9bf741dB4cf8E7e8A0176A6fc6", balance: 3_942_881_792_831_387_705n },
];

test("a balance is matched to its escrow regardless of address casing", () => {
  expect(getAssetLedgerUnits(ROWS, "0x364058aff6f36e01505fb2cc870f8b6bd4835e84")).toBe(
    5_000_000_000_000_000_000n
  );
  expect(getAssetLedgerUnits(ROWS, "0x6B232A2155Bd0C9bf741dB4cf8E7e8A0176A6fc6")).toBe(
    3_942_881_792_831_387_705n
  );
});

/** An asset the account simply does not hold is zero; an unread ledger is not. */
test("an absent row is zero, an unread ledger is null", () => {
  expect(getAssetLedgerUnits(ROWS, "0x9D806fD040a719D27a8E5E77dc5aE0ED1e089493")).toBe(0n);
  expect(getAssetLedgerUnits(null, "0x9D806fD040a719D27a8E5E77dc5aE0ED1e089493")).toBeNull();
});

/**
 * The case that sent a trader away empty-handed: the cash escrow is short, and the 5 USDC they can
 * actually withdraw sits in the other USDC escrow with no sign on screen that it exists.
 */
test("a blocked USDC row points at the other USDC escrow that holds a balance", () => {
  withChain(BASE_MAINNET_CHAIN_ID, () => {
    const assets = getWithdrawableAssets();
    const [cash] = assets;

    const sibling = findSiblingAssetWithBalance({ assets, current: cash, rows: ROWS });

    expect(sibling?.id).toBe("usdc-wrapped");
  });
});

test("no sibling is offered across tickers, or when it holds nothing", () => {
  withChain(BASE_MAINNET_CHAIN_ID, () => {
    const assets = getWithdrawableAssets();
    const cngn = assets[2];

    // cNGN has no second escrow, so nothing to fall back to.
    expect(findSiblingAssetWithBalance({ assets, current: cngn, rows: ROWS })).toBeNull();

    // And an empty sibling is not worth suggesting.
    const emptyWrapped = [{ asset: ROWS[1].asset, balance: ROWS[1].balance }];
    expect(
      findSiblingAssetWithBalance({ assets, current: assets[0], rows: emptyWrapped })
    ).toBeNull();
  });
});
