"use client";

import { ExternalLink } from "lucide-react";
import {
  buildPerpOrderHistoryActivityView,
  buildPerpTradeHistoryActivityView,
} from "@/lib/account-activity-views";
import { formatBalance } from "@/lib/account-balance-display";
import type { AccountFill, OrderHistoryOrder } from "@/lib/order-history.types";
import { buildPerpBalancesView, buildPerpPositionsView, parsePerpState } from "@/lib/perp-market";
import type { PerpAccountMargin, PerpPosition } from "@/lib/perp-market.types";
import { PERP_BOTTOM_TABS, PERP_MARKET_LABEL } from "@/lib/perp-terminal-config";
import { AccountSummary } from "@/ui/trading-terminal/order-form/AccountSummary";
import { PerpOrderFormPanel } from "@/ui/trading-terminal/PerpOrderFormPanel";
import { TradingActivityPanel } from "@/ui/trading-terminal/TradingActivityPanel";

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

/**
 * A funded perp account at the widths the ticket has to hold: seven-figure USDC cash, an
 * eight-figure cNGN collateral balance. The ticket's account line and the Account panel's rows
 * are laid out for these, not for round test balances.
 */
const FIXTURE_ACCOUNT: PerpAccountMargin = {
  cash: 1_234_567.89,
  cashUnits: 1_234_567_890_000_000_000_000_000n,
  initialMarginSurplus: 1_234_567.89,
  maintenanceMarginSurplus: 1_234_567.89,
  collateral: [
    {
      balance: 98_765_432.1,
      balanceUnits: 98_765_432_100_000_000_000_000_000n,
      escrow: "0x37c976bb000000000000000000000000000000000",
      marginValueUsd: 35_555.55,
      symbol: "cNGN",
      valueUsd: 71_111.11,
    },
  ],
};

/** A seven-figure open long, well under water, so the Position line and the P&L cells are at full width. */
const FIXTURE_POSITION: PerpPosition = {
  engineSize: 1_234_567n,
  initialMarginSurplus: 1_234_567.89,
  liquidationPrice: null,
  maintenanceMarginSurplus: 1_234_567.89,
  markPrice: FIXTURE_PRICE,
  notionalUsd: 1_234_567 * FIXTURE_PRICE,
  uiSide: "long",
  uiSize: 1_234_567,
  unrealizedPnl: -12_345.67,
};

/** A second, opposite position: two rows is what shows whether the columns stay aligned. */
const FIXTURE_SHORT: PerpPosition = {
  engineSize: 1_387_000n,
  initialMarginSurplus: 250.35,
  liquidationPrice: 0.000_951_2,
  maintenanceMarginSurplus: 250.35,
  markPrice: FIXTURE_PRICE,
  notionalUsd: 1_387_000 * FIXTURE_PRICE,
  uiSide: "short",
  uiSize: 1_387_000,
  unrealizedPnl: -15.66,
};

/** Three orders as GET /v1/orders returns them: a filled long, a filled post-only long, a resting reduce-only close. */
const FIXTURE_ORDERS: OrderHistoryOrder[] = [
  {
    created_at: "2026-10-07T17:01:00Z",
    desired_amount: "1817",
    filled_amount: "1817",
    filled_quote: "1.335132",
    limit_price: "0.000738500000000000",
    market: "cNGN-PERP",
    order_id: "perp-3",
    side: "buy",
    spot_contract: { ui_intent: { price: "0.0007385", side: "buy", size: "1817" } },
    status: "filled",
  },
  {
    created_at: "2026-10-07T11:01:00Z",
    desired_amount: "56476",
    filled_amount: "56476",
    filled_quote: "41.50986",
    limit_price: "0.000738700000000000",
    market: "cNGN-PERP",
    order_id: "perp-2",
    post_only: true,
    side: "buy",
    spot_contract: { ui_intent: { price: "0.0007387", side: "buy", size: "56476" } },
    status: "filled",
  },
  {
    created_at: "2026-10-07T00:32:00Z",
    desired_amount: "327",
    filled_amount: "0",
    limit_price: "0.000728000000000000",
    market: "cNGN-PERP",
    order_id: "perp-1",
    reduce_only: true,
    side: "sell",
    spot_contract: { ui_intent: { price: "0.000728", side: "sell", size: "327" } },
    status: "active",
  },
];

/** The fills behind the two filled orders above, as GET /v1/fills returns them. */
const FIXTURE_FILLS: AccountFill[] = [
  {
    created_at: "2026-10-07T17:01:02Z",
    fee: "0.003338",
    liquidity: "taker",
    market: "cNGN-PERP",
    order_id: "perp-3",
    price: "0.0007348",
    side: "buy",
    size: "1817",
    spot_contract: { ui_intent: { price: "0.0007348", side: "buy", size: "1817" } },
    trade_id: 3,
    tx_hash: "0xb3df1d1d000000000000000000000000000000000000000000000000000000000",
  },
  {
    created_at: "2026-10-07T11:01:05Z",
    fee: "0",
    liquidity: "maker",
    market: "cNGN-PERP",
    order_id: "perp-2",
    price: "0.000735",
    side: "buy",
    size: "56476",
    spot_contract: { ui_intent: { price: "0.000735", side: "buy", size: "56476" } },
    trade_id: 2,
    tx_hash: "0xb3df1d1d000000000000000000000000000000000000000000000000000000001",
  },
  {
    created_at: "2026-10-06T22:14:40Z",
    fee: "0.000598",
    liquidity: "taker",
    market: "cNGN-PERP",
    order_id: "perp-0",
    price: "0.0007316",
    side: "sell",
    size: "327",
    spot_contract: { ui_intent: { price: "0.0007316", side: "sell", size: "327" } },
    trade_id: 1,
  },
];

const FIXTURE_ROW_BUTTON =
  "cursor-pointer rounded-sm bg-input-bg px-2 py-1 font-medium text-[11px] text-panel-text ring-1 ring-panel-border";

export function PerpLayoutFixture() {
  return (
    <main className="flex min-h-screen flex-col gap-3 bg-terminal-bg p-3 text-foreground">
      {/* The Positions tab with the fixture's position, as the terminal lays it out. */}
      <div className="h-[220px] w-full">
        <TradingActivityPanel
          activityView={buildPerpPositionsView(
            [FIXTURE_POSITION, FIXTURE_SHORT],
            PERP_MARKET_LABEL,
            {
              account: FIXTURE_ACCOUNT,
              state: FIXTURE_STATE,
            }
          )}
          footerLinks={[]}
          isSignedIn
          onTabSelect={() => undefined}
          rowAction={() => (
            <button className={FIXTURE_ROW_BUTTON} type="button">
              Close
            </button>
          )}
          selectedTab="positions"
          tabs={PERP_BOTTOM_TABS.map((tab) =>
            tab.id === "positions" ? { ...tab, label: `${tab.label} (2)` } : tab
          )}
        />
      </div>
      {/* The Order History tab with the fixture's orders. */}
      <div className="h-[200px] w-full">
        <TradingActivityPanel
          activityView={buildPerpOrderHistoryActivityView(FIXTURE_ORDERS, PERP_MARKET_LABEL, "UTC")}
          footerLinks={[]}
          isSignedIn
          onTabSelect={() => undefined}
          selectedTab="order-history"
          tabs={PERP_BOTTOM_TABS}
        />
      </div>
      {/* The Balances tab: cash, the cNGN posted as collateral, Deposit and Withdraw on each. */}
      <div className="h-[170px] w-full">
        <TradingActivityPanel
          activityView={buildPerpBalancesView(FIXTURE_ACCOUNT)}
          footerLinks={[]}
          isSignedIn
          onTabSelect={() => undefined}
          rowAction={() => (
            <span className="inline-flex gap-1.5">
              <button className={FIXTURE_ROW_BUTTON} type="button">
                Deposit
              </button>
              <button className={FIXTURE_ROW_BUTTON} type="button">
                Withdraw
              </button>
              <button className={FIXTURE_ROW_BUTTON} type="button">
                Swap
              </button>
            </span>
          )}
          selectedTab="balances"
          tabs={PERP_BOTTOM_TABS}
        />
      </div>
      {/* The Trade History tab with the fixture's fills; the last has no settling transaction to link. */}
      <div className="h-[200px] w-full">
        <TradingActivityPanel
          activityView={buildPerpTradeHistoryActivityView(FIXTURE_FILLS, PERP_MARKET_LABEL, "UTC")}
          footerLinks={[]}
          isSignedIn
          onTabSelect={() => undefined}
          rowAction={(rowIndex) =>
            FIXTURE_FILLS[rowIndex]?.tx_hash === undefined ? null : (
              <span className="inline-flex text-panel-text-muted">
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </span>
            )
          }
          selectedTab="trade-history"
          tabs={PERP_BOTTOM_TABS}
        />
      </div>
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
