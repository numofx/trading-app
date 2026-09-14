/** What became of a signed withdrawal handed to the venue. */
export type WithdrawalSubmitOutcome =
  /** Mined and succeeded. */
  | { blockNumber: bigint; kind: "settled"; txHash: `0x${string}` }
  /** Broadcast, but the receipt was not in yet: it may still land, or revert. */
  | { kind: "pending"; txHash: `0x${string}` }
  /** Mined and reverted, so nothing moved. */
  | { kind: "reverted"; reason: string; txHash: `0x${string}` }
  /** Refused before anything was sent. */
  | { kind: "rejected"; reason: string }
  /** The venue could not say whether it was sent. */
  | { kind: "unknown"; reason: string };
