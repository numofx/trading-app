"use client";

import { formatBalance } from "@/lib/account-balance-display";
import { parsePerpState } from "@/lib/perp-market";
import type { PerpAccountMargin, PerpPosition } from "@/lib/perp-market.types";
import { AccountSummary } from "@/ui/trading-terminal/order-form/AccountSummary";
import { PerpOrderFormPanel } from "@/ui/trading-terminal/PerpOrderFormPanel";

/** USDC per cNGN, about ₦1,388.89 per USDC. */
const FIXTURE_PRICE = 1 / 1388.89;

/** The perp's chain state, in the shape markets-service serves it. */
const FIXTURE_STATE = parsePerpState({
  funding_interval_seconds: 3600,
  index_price_ui: FIXTURE_PRICE.toFixed(10),
  initial_margin_rate: "0.33333",
  maintenance_margin_rate: "0.2",
  mark_price_ui: FIXTURE_PRICE.toFixed(10),
  max_leverage: "3",
  open_interest_usd: "7200",
  trading_enabled: true,
  // The chain's rate as served: positive, so longs (long cNGN) pay.
  ui_long_funding_rate_1h: "0.0000125",
});

/** A funded perp account: USDC cash plus some cNGN posted as collateral. */
const FIXTURE_ACCOUNT: PerpAccountMargin = {
  cash: 250,
  cashUnits: 250n * 10n ** 18n,
  initialMarginSurplus: 250.35,
  maintenanceMarginSurplus: 250.35,
  collateral: [
    {
      balance: 970.69,
      balanceUnits: 970_690_000_000_000_000_000n,
      escrow: "0x37c976bb000000000000000000000000000000000",
      marginValueUsd: 0.35,
      symbol: "cNGN",
      valueUsd: 0.7,
    },
  ],
};

/** A small open long, so the Position row and reduce-only have something to start from. */
const FIXTURE_POSITION: PerpPosition = {
  engineSize: 20_000n,
  initialMarginSurplus: 250.35,
  liquidationPrice: null,
  maintenanceMarginSurplus: 250.35,
  markPrice: FIXTURE_PRICE,
  notionalUsd: 20_000 * FIXTURE_PRICE,
  uiSide: "long",
  uiSize: 20_000,
  unrealizedPnl: 0.12,
};

export function PerpLayoutFixture() {
  return (
    <main className="flex min-h-screen flex-col bg-terminal-bg p-3 text-foreground">
      <div className="mx-auto flex w-full max-w-[340px] flex-col gap-2">
        <PerpOrderFormPanel
          account={FIXTURE_ACCOUNT}
          availableMargin={FIXTURE_ACCOUNT.initialMarginSurplus}
          hasWallet
          onDepositRequest={() => undefined}
          onSubmit={() => undefined}
          position={FIXTURE_POSITION}
          referencePrice={FIXTURE_PRICE}
          state={FIXTURE_STATE}
          takerFeeBps={25}
        />
        <AccountSummary
          rows={[
            {
              balance: formatBalance(FIXTURE_ACCOUNT.cash, "USDC"),
              symbol: "USDC",
              onWithdraw: () => undefined,
            },
            {
              balance: formatBalance(FIXTURE_ACCOUNT.collateral[0]?.balance ?? null, "cNGN"),
              symbol: "cNGN",
              onWithdraw: () => undefined,
            },
          ]}
        />
      </div>
    </main>
  );
}
