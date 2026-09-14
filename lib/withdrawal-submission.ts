import { Duration } from "effect";
import { encodeAbiParameters, getAddress } from "viem";
import { getAppChain } from "@/lib/base-public-client";
import { createOrderNonce } from "@/lib/spot-order-submission";
import { getMatchingAddress, getWithdrawalModuleAddress } from "@/lib/subaccount-deposit-config";
import type { WithdrawalSubmitOutcome } from "@/lib/withdrawal-submission.types";

/**
 * How long a signed withdrawal stays valid. It only has to cover the wallet prompt and the venue submitting it;
 * markets-service refuses anything expiring more than an hour out, since a live signature is a standing
 * authorization to move the trader's funds.
 */
export const WITHDRAWAL_SIGNATURE_LIFETIME_SECONDS = Duration.toSeconds("10 minutes");

const UNSIGNED_INTEGER_PATTERN = /^\d+$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const TRAILING_PERIOD_PATTERN = /\.?$/;

/** Matching's EIP-712 Action, the same type every order signs; only the module and its data differ. */
const ACTION_TYPES = {
  Action: [
    { name: "subaccountId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "module", type: "address" },
    { name: "data", type: "bytes" },
    { name: "expiry", type: "uint256" },
    { name: "owner", type: "address" },
    { name: "signer", type: "address" },
  ],
} as const;

/** `abi.encode(WithdrawalData{address asset; uint256 assetAmount})`, the amount in the token's own decimals. */
export function encodeWithdrawalData(assetAddress: string, amountUnits: bigint) {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [getAddress(assetAddress), amountUnits]
  );
}

/**
 * Builds the signed withdrawal for an account Matching holds.
 *
 * Every account the app creates is deposited into Matching, so the escrow will not take a withdrawal from the
 * wallet directly. Instead the wallet signs a WithdrawalModule `Action` — no gas — and the venue's executor
 * submits it through `Matching.verifyAndMatch`, which lends the account to the module for the call. The module
 * always pays `owner`, so there is no recipient to choose. `signer` is the owner until session keys exist.
 */
export function buildWithdrawalEnvelope({
  amountUnits,
  assetAddress,
  nowSeconds = Math.floor(Date.now() / 1000),
  subaccountId,
  walletAddress,
}: {
  /** In the token's native decimals, as `validateWithdrawAmount` returns it. */
  amountUnits: bigint;
  /** The escrow the account's balance is held in: the wrapped asset, not the ERC-20 it pays out. */
  assetAddress: string;
  nowSeconds?: number;
  subaccountId: string;
  walletAddress: string;
}) {
  if (!UNSIGNED_INTEGER_PATTERN.test(subaccountId)) {
    throw new Error(`Invalid subaccount id: ${subaccountId}`);
  }
  if (amountUnits <= 0n) {
    throw new Error("A withdrawal amount must be greater than zero");
  }

  const owner = getAddress(walletAddress);
  const moduleAddress = getWithdrawalModuleAddress();
  const nonce = createOrderNonce();
  const expiry = BigInt(nowSeconds + WITHDRAWAL_SIGNATURE_LIFETIME_SECONDS);
  const data = encodeWithdrawalData(assetAddress, amountUnits);

  return {
    payload: {
      action: {
        data,
        expiry: expiry.toString(),
        module: moduleAddress,
        nonce: nonce.toString(),
        owner,
        signer: owner,
        subaccount_id: subaccountId,
      },
    },
    typedData: {
      primaryType: "Action" as const,
      types: ACTION_TYPES,
      domain: {
        chainId: getAppChain().id,
        name: "Matching" as const,
        verifyingContract: getMatchingAddress(),
        version: "1.0" as const,
      },
      message: {
        data,
        expiry,
        module: moduleAddress,
        nonce,
        owner,
        signer: owner,
        subaccountId: BigInt(subaccountId),
      },
    },
  };
}

/** Reverts worth putting in the trader's words; anything else falls back to the venue's own message. */
const REVERT_COPY: Record<string, (currency: string) => string> = {
  BM_NonceAlreadyUsed: () =>
    "This signed withdrawal was already used. Check your balance before signing another.",
  OV_ActionExpired: () => "The signature expired before the venue could submit it. Try again.",
  SRM_NoNegativeCash: (currency) => `That is more ${currency} than the account can withdraw.`,
  SRM_PortfolioBelowMargin: () =>
    "Withdrawing this much would leave the account below its margin requirement.",
  WERC_CannotBeNegative: (currency) => `That is more ${currency} than the account holds.`,
};

export function describeWithdrawalRevert(
  revert: string | undefined,
  error: string | undefined,
  currency: string
) {
  if (revert?.includes("transfer amount exceeds balance")) {
    return `The venue's ${currency} escrow is short of tokens, so this withdrawal cannot settle right now.`;
  }
  const copy = revert === undefined ? undefined : REVERT_COPY[revert];
  return copy === undefined ? (error ?? "The venue refused the withdrawal.") : copy(currency);
}

const UNKNOWN_OUTCOME =
  "The venue could not confirm whether the withdrawal went through. Check your wallet balance before trying again.";

type WithdrawalResponseBody = {
  accepted?: unknown;
  block_number?: unknown;
  error?: unknown;
  receipt_status?: unknown;
  revert?: unknown;
  tx_hash?: unknown;
};

function rejected(reason: string): WithdrawalSubmitOutcome {
  return {
    kind: "rejected",
    reason: `${reason.replace(TRAILING_PERIOD_PATTERN, ".")} Nothing was sent.`,
  };
}

function interpretReceipt(body: WithdrawalResponseBody): WithdrawalSubmitOutcome {
  if (typeof body.tx_hash !== "string" || !TX_HASH_PATTERN.test(body.tx_hash)) {
    return { kind: "unknown", reason: UNKNOWN_OUTCOME };
  }
  const txHash = body.tx_hash as `0x${string}`;

  if (body.receipt_status === "reverted") {
    return {
      kind: "reverted",
      reason: "The withdrawal transaction reverted. Nothing was withdrawn.",
      txHash,
    };
  }
  const blockNumber = body.block_number;
  if (
    body.receipt_status === "success" &&
    body.accepted === true &&
    typeof blockNumber === "string" &&
    UNSIGNED_INTEGER_PATTERN.test(blockNumber)
  ) {
    return { blockNumber: BigInt(blockNumber), kind: "settled", txHash };
  }
  // "timeout": broadcast, receipt not in yet. The transaction may still land, so it is watched, not failed.
  return { kind: "pending", txHash };
}

/** Everything but a 502 or an unexpected failure is a refusal with nothing sent. */
function interpretRefusal(
  httpStatus: number,
  body: WithdrawalResponseBody,
  currency: string
): WithdrawalSubmitOutcome {
  const error = typeof body.error === "string" ? body.error : undefined;
  const revert = typeof body.revert === "string" ? body.revert : undefined;

  switch (httpStatus) {
    case 400:
      return rejected(error ?? "The venue refused the withdrawal request");
    case 401:
      return rejected("Your signature was not accepted");
    case 403:
      return rejected("This wallet is not the recorded owner of the trading account");
    case 404:
    case 503:
      return rejected("Withdrawals are temporarily unavailable");
    case 422:
      return rejected(describeWithdrawalRevert(revert, error, currency));
    case 429:
      return rejected(
        "A withdrawal from this account is already in progress. Wait for it to finish, then try again"
      );
    default:
      return { kind: "unknown", reason: UNKNOWN_OUTCOME };
  }
}

/**
 * Reads markets-service's answer to `POST /v1/withdrawals`.
 *
 * The one distinction that matters to a trader is whether anything was sent: a refusal says so, and an outcome
 * the venue could not confirm tells them to check their balance rather than sign again, because a second signed
 * withdrawal is a second withdrawal.
 */
export function interpretWithdrawalResponse(
  httpStatus: number,
  body: unknown,
  currency: string
): WithdrawalSubmitOutcome {
  const record = (typeof body === "object" && body !== null ? body : {}) as WithdrawalResponseBody;
  return httpStatus === 200
    ? interpretReceipt(record)
    : interpretRefusal(httpStatus, record, currency);
}
