/**
 * Types for the subaccount USDC deposit flow.
 *
 * Two on-chain paths share one machine:
 * - "create-and-deposit": SubAccountCreator.createAndDepositSubAccount pulls the token
 *   from the wallet, so the wallet must approve the creator contract.
 * - "deposit-existing": WLWrappedERC20Asset.deposit pulls the token directly, so the
 *   wallet must approve the base asset contract.
 */

export type DepositPath = "create-and-deposit" | "deposit-existing";

export type DepositAddresses = {
  /**
   * WLWrappedERC20Asset contract (risk-core "base asset"). Spender for the
   * deposit-existing path. NOT the ERC-20 token: in the risk-core deployment
   * artifacts this is the `base` field, while the token is `wrappedAsset`.
   */
  baseAssetContract: `0x${string}`;
  manager: `0x${string}`;
  /** SubAccountCreator periphery contract. Spender for the create-and-deposit path. */
  subaccountCreator: `0x${string}`;
  /** Underlying ERC-20 token pulled from the wallet (`wrappedAsset` in the artifacts). */
  token: `0x${string}`;
};

export type DepositPreflight = {
  /** Current ERC-20 allowance granted to the path's spender, in native token decimals. */
  allowance: bigint;
  /** Wallet balance of the underlying token, in native token decimals. */
  tokenBalance: bigint;
  /** Read from the token contract; USDC-likes are usually 6 but never assume. */
  tokenDecimals: number;
  /** WLWrappedERC20Asset.wlEnabled — when true, deposits require a whitelisted subaccount. */
  whitelistEnabled: boolean;
  /**
   * WLWrappedERC20Asset.wlAccounts(subaccountId). Null on the create path: a
   * subaccount that does not exist yet cannot be whitelisted.
   */
  whitelisted: boolean | null;
};

export type DepositBlockedReason = "insufficient-balance" | "not-whitelisted" | "zero-amount";

export type DepositErrorStep = "approval" | "deposit" | "preflight";

export type DepositFlowContext = {
  addresses: DepositAddresses;
  /** Deposit amount in the token's native decimals. */
  amountUnits: bigint;
  path: DepositPath;
  preflight: DepositPreflight | null;
  /** Existing trading subaccount id; null exactly when path is "create-and-deposit". */
  subaccountId: string | null;
  walletAddress: `0x${string}`;
};

export type DepositFlowState =
  | { context: DepositFlowContext; reason: DepositBlockedReason; status: "blocked" }
  | { context: DepositFlowContext; error: string; status: "failed"; step: DepositErrorStep }
  | { context: DepositFlowContext; status: "approving"; txHash: `0x${string}` }
  | { context: DepositFlowContext; status: "awaiting-approval" }
  | { context: DepositFlowContext; status: "awaiting-deposit" }
  | { context: DepositFlowContext; status: "depositing"; txHash: `0x${string}` }
  | { context: DepositFlowContext; status: "preflight" }
  | { context: DepositFlowContext; status: "success"; subaccountId: string; txHash: `0x${string}` };

export type DepositFlowEvent =
  | { error: string; type: "ERRORED" }
  | { preflight: DepositPreflight; type: "PREFLIGHT_RESOLVED" }
  | { subaccountId?: string; type: "DEPOSIT_CONFIRMED" }
  | { txHash: `0x${string}`; type: "APPROVAL_SUBMITTED" }
  | { txHash: `0x${string}`; type: "DEPOSIT_SUBMITTED" }
  | { type: "APPROVAL_CONFIRMED" }
  | { type: "RETRY" };

/**
 * Side effects the hook/UI layer must execute for a given state. The machine never
 * touches the chain; it only describes what should happen next.
 */
export type DepositEffect =
  | {
      kind: "read-preflight";
      owner: `0x${string}`;
      spender: `0x${string}`;
      subaccountId: string | null;
      token: `0x${string}`;
    }
  | {
      amountUnits: bigint;
      kind: "request-approval";
      spender: `0x${string}`;
      token: `0x${string}`;
    }
  | {
      addresses: DepositAddresses;
      amountUnits: bigint;
      kind: "request-deposit";
      path: DepositPath;
      /** Required for deposit-existing; ignored on create-and-deposit. */
      subaccountId: string | null;
    }
  | {
      kind: "wait-for-receipt";
      txHash: `0x${string}`;
    };
