import { expect, test } from "bun:test";
import {
  concat,
  decodeAbiParameters,
  domainSeparator,
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildWithdrawalEnvelope,
  describeWithdrawalRevert,
  interpretWithdrawalResponse,
  WITHDRAWAL_SIGNATURE_LIFETIME_SECONDS,
} from "./withdrawal-submission.ts";

const WALLET = privateKeyToAccount(
  "0x1111111111111111111111111111111111111111111111111111111111111111"
);
const WRAPPED_USDC = "0x364058aFF6f36E01505fB2Cc870f8B6BD4835e84";
const WITHDRAWAL_MODULE = "0x0a10AE2f5D2482cE1e43bC309D430B8861C2b5aB";
const NOW = 1_789_400_000;
const TX_HASH = "0xd32f8816d84bb9ef07955f7be7c32d9828407b4948083ad10a59b66f1a199729";

/** Read from Matching on Base: `domainSeparator()` and `ACTION_TYPEHASH()`. */
const MAINNET_DOMAIN_SEPARATOR = "0xe288a23446cc556e67b493a2cd222c8538613f66905f4edadedcce1fbc73e35a";
const ACTION_TYPEHASH = "0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17";

function onMainnet(run) {
  const previous = process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID;
  process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID = "8453";
  try {
    return run();
  } finally {
    process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID = previous;
  }
}

/** Subaccount #19's USDC: 1.999575 USDC in native 6 decimals. */
function envelope(overrides = {}) {
  return onMainnet(() =>
    buildWithdrawalEnvelope({
      amountUnits: 1_999_575n,
      assetAddress: WRAPPED_USDC,
      nowSeconds: NOW,
      subaccountId: "19",
      walletAddress: WALLET.address,
      ...overrides,
    })
  );
}

test("a withdrawal signs one WithdrawalModule action that pays the wallet", () => {
  const { action } = envelope().payload;

  expect(action.module).toBe(WITHDRAWAL_MODULE);
  expect(action.subaccount_id).toBe("19");
  expect(action.owner).toBe(WALLET.address);
  expect(action.signer).toBe(WALLET.address);
  expect(action.expiry).toBe(String(NOW + WITHDRAWAL_SIGNATURE_LIFETIME_SECONDS));
  // Survives a JSON-number hop unrounded, like every order nonce.
  expect(Number.isSafeInteger(Number(action.nonce))).toBe(true);
});

test("its data is exactly the escrow asset and the amount in token units", () => {
  const { data } = envelope().payload.action;

  expect(data).toHaveLength(2 + 128);
  const [asset, amount] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], data);
  expect(asset).toBe(WRAPPED_USDC);
  expect(amount).toBe(1_999_575n);
});

test("it is signed against Matching's own domain, as the contract reports it", () => {
  expect(domainSeparator({ domain: envelope().typedData.domain })).toBe(MAINNET_DOMAIN_SEPARATOR);
});

// Rebuilt by hand from the contract's typehash, so a drift in field order or types shows up here and not
// as every withdrawal failing OV_InvalidSignature.
test("the action hashes exactly as ActionVerifier hashes it", () => {
  expect(
    keccak256(
      toBytes(
        "Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)"
      )
    )
  ).toBe(ACTION_TYPEHASH);

  const { typedData } = envelope();
  const m = typedData.message;
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
      ],
      [ACTION_TYPEHASH, m.subaccountId, m.nonce, m.module, keccak256(m.data), m.expiry, m.owner, m.signer]
    )
  );

  expect(hashTypedData(typedData)).toBe(
    keccak256(concat(["0x1901", MAINNET_DOMAIN_SEPARATOR, structHash]))
  );
});

test("a signature over it recovers to the wallet", async () => {
  const { typedData } = envelope();
  const signature = await WALLET.signTypedData(typedData);

  expect(getAddress(await recoverTypedDataAddress({ ...typedData, signature }))).toBe(WALLET.address);
});

test("each withdrawal gets its own nonce", () => {
  expect(envelope().payload.action.nonce).not.toBe(envelope().payload.action.nonce);
});

test("a zero amount or a malformed subaccount is refused before signing", () => {
  expect(() => envelope({ amountUnits: 0n })).toThrow();
  expect(() => envelope({ subaccountId: "0x13" })).toThrow();
});

test("a settled withdrawal carries its hash and block", () => {
  expect(
    interpretWithdrawalResponse(
      200,
      { accepted: true, block_number: "42", receipt_status: "success", tx_hash: TX_HASH },
      "USDC"
    )
  ).toEqual({ blockNumber: 42n, kind: "settled", txHash: TX_HASH });
});

test("a broadcast withdrawal without a receipt is watched, not failed", () => {
  expect(
    interpretWithdrawalResponse(200, { accepted: false, receipt_status: "timeout", tx_hash: TX_HASH }, "USDC")
  ).toEqual({ kind: "pending", txHash: TX_HASH });
});

test("a mined revert is reported with its hash", () => {
  const outcome = interpretWithdrawalResponse(
    200,
    { accepted: false, block_number: "42", receipt_status: "reverted", tx_hash: TX_HASH },
    "USDC"
  );
  expect(outcome.kind).toBe("reverted");
  expect(outcome.txHash).toBe(TX_HASH);
});

test("a 200 without a transaction hash is an unknown outcome, not a success", () => {
  for (const body of [null, { accepted: true }, { accepted: true, tx_hash: "dry-run" }]) {
    expect(interpretWithdrawalResponse(200, body, "USDC").kind).toBe("unknown");
  }
});

test("a refusal says nothing was sent, in the trader's terms where it can", () => {
  const cases = [
    [422, { error: "withdrawal would revert: WERC_CannotBeNegative", revert: "WERC_CannotBeNegative" }, "more USDC than the account holds"],
    [422, { error: "withdrawal would revert", revert: "ERC20: transfer amount exceeds balance" }, "escrow is short"],
    [422, { error: "withdrawal would revert: SRM_PortfolioBelowMargin", revert: "SRM_PortfolioBelowMargin" }, "margin requirement"],
    [422, { error: "withdrawal would revert: BM_NonceAlreadyUsed", revert: "BM_NonceAlreadyUsed" }, "already used"],
    [400, { error: "action has expired" }, "action has expired."],
    [401, { error: "signature does not authorize this action" }, "signature was not accepted"],
    [403, { error: "subaccount_id 19 is not owned by action.owner" }, "not the recorded owner"],
    [429, { error: "busy" }, "already in progress"],
    [503, { error: "withdrawals are not enabled" }, "temporarily unavailable"],
    [404, null, "temporarily unavailable"],
  ];
  for (const [status, body, phrase] of cases) {
    const outcome = interpretWithdrawalResponse(status, body, "USDC");
    expect(outcome.kind).toBe("rejected");
    expect(outcome.reason).toContain(phrase);
    expect(outcome.reason).toEndWith("Nothing was sent.");
  }
});

/** The executor may have broadcast before the connection failed; a second signature would withdraw twice. */
test("a gateway failure is an unknown outcome that says to check the balance first", () => {
  for (const status of [502, 500, 504]) {
    const outcome = interpretWithdrawalResponse(status, { error: "boom" }, "USDC");
    expect(outcome.kind).toBe("unknown");
    expect(outcome.reason).toContain("Check your wallet balance");
  }
});

test("an unrecognised revert falls back to the venue's own message", () => {
  expect(describeWithdrawalRevert("MW_UnknownManager", "withdrawal would revert: MW_UnknownManager", "cNGN")).toBe(
    "withdrawal would revert: MW_UnknownManager"
  );
});
