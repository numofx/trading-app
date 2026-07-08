import type {
  DepositAddresses,
  DepositEffect,
  DepositErrorStep,
  DepositFlowContext,
  DepositFlowEvent,
  DepositFlowState,
  DepositPath,
} from "@/lib/subaccount-deposit.types";

/**
 * Pure state machine for depositing USDC margin into a trading subaccount.
 *
 * Flow: preflight (reads) -> [blocked] -> awaiting-approval -> approving ->
 * awaiting-deposit -> depositing -> success, with any step able to move to
 * failed and RETRY returning to the step that failed.
 *
 * The whitelist rule comes from WLWrappedERC20Asset: when wlEnabled is true, only
 * whitelisted subaccounts can receive deposits. A freshly created subaccount cannot
 * be pre-whitelisted, so the create-and-deposit path is blocked outright while the
 * whitelist is enabled — surfacing that as "not-whitelisted" (an ops action) instead
 * of letting the transaction revert on-chain.
 */

/** ERC-20 spender the wallet must approve for the given path. */
export function getDepositSpender(path: DepositPath, addresses: DepositAddresses) {
  return path === "create-and-deposit" ? addresses.subaccountCreator : addresses.baseAssetContract;
}

export function startDepositFlow({
  addresses,
  amountUnits,
  subaccountId,
  walletAddress,
}: {
  addresses: DepositAddresses;
  amountUnits: bigint;
  subaccountId: string | null;
  walletAddress: `0x${string}`;
}): DepositFlowState {
  const context: DepositFlowContext = {
    addresses,
    amountUnits,
    path: subaccountId === null ? "create-and-deposit" : "deposit-existing",
    preflight: null,
    subaccountId,
    walletAddress,
  };

  if (amountUnits <= 0n) {
    return { context, reason: "zero-amount", status: "blocked" };
  }

  return { context, status: "preflight" };
}

function getErrorStep(status: DepositFlowState["status"]): DepositErrorStep {
  if (status === "awaiting-approval" || status === "approving") {
    return "approval";
  }

  if (status === "awaiting-deposit" || status === "depositing") {
    return "deposit";
  }

  return "preflight";
}

function resolvePreflight(context: DepositFlowContext): DepositFlowState {
  const preflight = context.preflight;

  if (preflight === null) {
    return { context, error: "Preflight data missing", status: "failed", step: "preflight" };
  }

  if (preflight.whitelistEnabled && preflight.whitelisted !== true) {
    return { context, reason: "not-whitelisted", status: "blocked" };
  }

  if (preflight.tokenBalance < context.amountUnits) {
    return { context, reason: "insufficient-balance", status: "blocked" };
  }

  if (preflight.allowance >= context.amountUnits) {
    return { context, status: "awaiting-deposit" };
  }

  return { context, status: "awaiting-approval" };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive state/event matrix reads clearest as one reducer.
export function transitionDepositFlow(state: DepositFlowState, event: DepositFlowEvent): DepositFlowState {
  if (event.type === "ERRORED") {
    if (state.status === "success" || state.status === "blocked" || state.status === "failed") {
      return state;
    }
    return { context: state.context, error: event.error, status: "failed", step: getErrorStep(state.status) };
  }

  switch (state.status) {
    case "preflight": {
      if (event.type !== "PREFLIGHT_RESOLVED") {
        return state;
      }
      return resolvePreflight({ ...state.context, preflight: event.preflight });
    }

    case "awaiting-approval": {
      if (event.type !== "APPROVAL_SUBMITTED") {
        return state;
      }
      return { context: state.context, status: "approving", txHash: event.txHash };
    }

    case "approving": {
      if (event.type !== "APPROVAL_CONFIRMED") {
        return state;
      }
      return { context: state.context, status: "awaiting-deposit" };
    }

    case "awaiting-deposit": {
      if (event.type !== "DEPOSIT_SUBMITTED") {
        return state;
      }
      return { context: state.context, status: "depositing", txHash: event.txHash };
    }

    case "depositing": {
      if (event.type !== "DEPOSIT_CONFIRMED") {
        return state;
      }

      const subaccountId = event.subaccountId ?? state.context.subaccountId;
      if (subaccountId === null) {
        return {
          context: state.context,
          error: "Deposit confirmed but the created subaccount id could not be resolved",
          status: "failed",
          step: "deposit",
        };
      }

      return { context: state.context, status: "success", subaccountId, txHash: state.txHash };
    }

    case "failed": {
      if (event.type !== "RETRY") {
        return state;
      }

      if (state.step === "approval") {
        return { context: state.context, status: "awaiting-approval" };
      }

      if (state.step === "deposit") {
        return { context: state.context, status: "awaiting-deposit" };
      }

      // Preflight reads may be stale after a failure; re-run them from scratch.
      return { context: { ...state.context, preflight: null }, status: "preflight" };
    }

    default: {
      return state;
    }
  }
}

/** Effect the executor layer must run for the current state; null when user input or a terminal state. */
export function getDepositEffect(state: DepositFlowState): DepositEffect | null {
  const { context } = state;

  switch (state.status) {
    case "preflight": {
      return {
        kind: "read-preflight",
        owner: context.walletAddress,
        spender: getDepositSpender(context.path, context.addresses),
        subaccountId: context.subaccountId,
        token: context.addresses.token,
      };
    }

    case "awaiting-approval": {
      return {
        amountUnits: context.amountUnits,
        kind: "request-approval",
        spender: getDepositSpender(context.path, context.addresses),
        token: context.addresses.token,
      };
    }

    case "approving":
    case "depositing": {
      return { kind: "wait-for-receipt", txHash: state.txHash };
    }

    case "awaiting-deposit": {
      return {
        addresses: context.addresses,
        amountUnits: context.amountUnits,
        kind: "request-deposit",
        path: context.path,
        subaccountId: context.subaccountId,
      };
    }

    default: {
      return null;
    }
  }
}
