/** One PerpAsset event, decoded, in chain order. All fixed-point values are 18-decimal. */
export type PerpFundingLog =
  | {
      eventName: "AggregatedFundingUpdated";
      /** The hourly rate the update accrued at. */
      fundingRate: bigint;
      /** The block's timestamp, seconds: `_updateFunding` stamps it on every update. */
      lastFundingPaidAt: bigint;
    }
  | {
      eventName: "FundingAppliedOnAccount";
      accountId: bigint;
      /** USDC credited (positive) or charged (negative) to the account's position. */
      funding: bigint;
      /** The global aggregate the account was brought up to. */
      aggregatedFundingRate: bigint;
    };

/** Funding the PerpAsset booked to one account, at one touch of that account. */
export type PerpFundingPayment = {
  /** Seconds since the epoch: the block the funding was booked in. */
  timestamp: number;
  /** cNGN held while the funding accrued; positive long, negative short. */
  size: number;
  /** The hourly rate in force when it was booked, as a fraction (-0.000017 is -0.0017%). */
  rate: number;
  /** USDC; positive received, negative paid. */
  payment: number;
};

/** Funding accrued since the account was last touched, not yet booked: an estimate at the live index. */
export type PerpFundingAccrual = {
  size: number;
  rate: number;
  payment: number;
};
