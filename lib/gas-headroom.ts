/** Gas headroom over an estimate, in percent. */
const GAS_HEADROOM_PCT = 150n;

/**
 * Never less than this much over the estimate. The perp cash (a CashAsset with interest accrual)
 * skips accrual when it was already touched in the block an estimate runs against, and runs it in
 * full in the block the transaction lands in: about 59k more gas once anything on the stack is
 * borrowed (numofx/exchange `CngnPerpStackFork.testDepositGasDependsOnWhetherTheCashWasTouchedThisBlock`).
 * A wallet's exact estimate then reverts out of gas.
 */
const GAS_HEADROOM_MIN = 100_000n;

/** The gas limit to send for `estimate`: 1.5x, and at least 100k over it. Unused gas is refunded. */
export function withGasHeadroom(estimate: bigint) {
  const scaled = (estimate * GAS_HEADROOM_PCT) / 100n;
  return scaled > estimate + GAS_HEADROOM_MIN ? scaled : estimate + GAS_HEADROOM_MIN;
}
