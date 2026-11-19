import { expect, test } from "bun:test";
import { getAddress, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  bookTakeMaxFee,
  buildBookTakeEnvelope,
  depthToLevels,
  interpretBookTakeResponse,
  toWad,
} from "./book-take-submission.ts";

const CNGN_BOOK = "0x5a35f149005Ce74b874F7Cf07CC2618BFA4F8Bd4";
const NOW = 1_795_100_000;
const account = privateKeyToAccount(`0x${"11".repeat(32)}`);

// `cast abi-encode "f(address,uint256,bool,uint256,uint256,uint256,uint256,uint64,uint16,bool)" <book> 1 true
//  1000000000000000000 700000000000000 1000000000000000000 1400000000000000000 1795100090 255 false`:
// one cNGN-30NOV26 contract bought at no more than 0.0007, all or nothing, the fee bounded at 20 bps of the limit.
const CAST_ONE_CONTRACT_BUY =
  "0x0000000000000000000000005a35f149005ce74b874f7cf07cc2618bfa4f8bd4000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000000027ca57357c0000000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000000136dcc951d8c0000000000000000000000000000000000000000000000000000000000006aff0dba00000000000000000000000000000000000000000000000000000000000000ff0000000000000000000000000000000000000000000000000000000000000000";

function oneContract(overrides = {}) {
  return buildBookTakeEnvelope({
    amountScale: 10n ** 15n,
    book: CNGN_BOOK,
    contractSize: 1_000_000n,
    isBuy: true,
    limitPrice: "0.0007",
    marketId: 1,
    nowSeconds: NOW,
    reduceOnly: false,
    subaccountId: "61",
    takerFeeBps: 15,
    units: 1000,
    walletAddress: account.address,
    ...overrides,
  });
}

test("the take data is exactly what the contract decodes", () => {
  const envelope = oneContract();
  expect(envelope.payload.action.data).toBe(CAST_ONE_CONTRACT_BUY);
  expect(envelope.amount).toBe(10n ** 18n);
  expect(envelope.maxFee).toBe(1_400_000_000_000_000_000n);
  expect(envelope.payload.action.module).toBe(
    getAddress("0x1D1FcAa8C1677dF51dda4F26bc391B91b98dEBE3")
  );
  expect(envelope.payload.action.owner).toBe(account.address);
  expect(envelope.payload.action.signer).toBe(account.address);
});

test("the signed Action recovers to the wallet", async () => {
  const envelope = oneContract();
  const signature = await account.signTypedData(envelope.typedData);
  expect(await recoverTypedDataAddress({ ...envelope.typedData, signature })).toBe(account.address);
});

test("the fee bound is the fee plus 5 bps headroom on the notional at the limit", () => {
  // 1 EURC-30NOV26 contract (1,000 EURC) at 1.1: 1,100 USDC notional, 5 + 5 bps = 1.1 USDC
  expect(bookTakeMaxFee(10n ** 18n, toWad("1.1"), 1000n, 5n)).toBe(1_100_000_000_000_000_000n);
});

test("prices convert exactly, and a bad price or size is refused", () => {
  expect(toWad("0.00068744")).toBe(687_440_000_000_000n);
  expect(toWad("1,096.5")).toBe(1_096_500_000_000_000_000_000n);
  expect(() => toWad("0.0000000000000000001")).toThrow();
  expect(() => toWad("-1")).toThrow();
  expect(() => oneContract({ units: 0 })).toThrow();
  expect(() => oneContract({ units: 1.5 })).toThrow();
  expect(() => oneContract({ limitPrice: "0" })).toThrow();
});

test("the venue's answers read as the trader needs them", () => {
  const tx = `0x${"ab".repeat(32)}`;
  expect(
    interpretBookTakeResponse(200, {
      accepted: true,
      block_number: "59344000",
      receipt_status: "success",
      tx_hash: tx,
    })
  ).toEqual({ blockNumber: 59_344_000n, kind: "filled", txHash: tx });
  expect(interpretBookTakeResponse(200, { receipt_status: "timeout", tx_hash: tx }).kind).toBe(
    "pending"
  );
  expect(interpretBookTakeResponse(200, { receipt_status: "reverted", tx_hash: tx }).kind).toBe(
    "reverted"
  );
  expect(interpretBookTakeResponse(200, {}).kind).toBe("unknown");
  const thin = interpretBookTakeResponse(422, {
    error: "take would revert: OB_BelowMinFill",
    revert: "OB_BelowMinFill",
  });
  expect(thin.kind).toBe("rejected");
  expect(thin.reason).toContain("Not enough liquidity");
  expect(thin.reason).toContain("Nothing was traded.");
  expect(interpretBookTakeResponse(403, {}).reason).toContain("not the recorded owner");
  expect(interpretBookTakeResponse(502, {}).kind).toBe("unknown");
});

test("the depth ladder becomes marginal book levels, ending where the curve runs out", () => {
  const levels = depthToLevels(
    [
      { avg_price: "0.0007", contracts: "0.001", filled: "0.001" },
      { avg_price: "0.0007", contracts: "1", filled: "1" },
      { avg_price: "0.00071", contracts: "2", filled: "2" },
      { contracts: "5", filled: "2" },
    ],
    1000
  );
  expect(levels.length).toBe(3);
  expect(levels[1].price).toBeCloseTo(0.0007, 12);
  // the second contract cost 2 * 0.00071 - 1 * 0.0007 = 0.00072
  expect(levels[2].price).toBeCloseTo(0.000_72, 12);
  expect(levels[2].size).toBe(1000);
  expect(levels[2].total).toBe(2000);
});

test("a later series signs its own market id", () => {
  const envelope = oneContract({ marketId: 2 });
  // the market id is BookTakeData's second word
  expect(envelope.payload.action.data.slice(2 + 64, 2 + 128)).toBe(`${"0".repeat(63)}2`);
});
