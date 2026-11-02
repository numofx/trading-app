"use client";

import { useState } from "react";
import { createWalletClient, custom } from "viem";
import { getAppChain } from "@/lib/base-public-client";
import type { OptionBottomTab, OptionPosition, OwnOptionOrder } from "@/lib/option-activity";
import {
  buildOptionBalancesView,
  buildOptionOpenOrdersView,
  buildOptionOrderHistoryView,
  buildOptionPositionsView,
  buildOptionTradeHistoryView,
  isOfOptionSeries,
  OPTION_BOTTOM_TABS,
  optionUnitsBySymbol,
} from "@/lib/option-activity";
import type { OptionOverviewRow } from "@/lib/option-chain";
import type { OptionSide } from "@/lib/option-order";
import { FOOTER_LINKS } from "@/lib/spot-terminal-config";
import type { ActivityView } from "@/lib/trading.types";
import { useTerminalSession } from "@/ui/trading-terminal/TerminalSession";
import { TradingActivityPanel } from "@/ui/trading-terminal/TradingActivityPanel";
import { useSignedHistoryTabs } from "@/ui/trading-terminal/useSignedHistoryTabs";

const ROW_BUTTON_CLASSES =
  "cursor-pointer rounded-sm bg-input-bg px-2 py-1 font-medium text-[11px] text-panel-text ring-1 ring-panel-border transition-colors hover:text-panel-text-active disabled:cursor-wait disabled:opacity-60";

type Session = ReturnType<typeof useTerminalSession>;

/** Signs the history login with personal_sign, or nothing without a wallet. */
function historySigner(session: Session) {
  const wallet = session.primaryWallet;
  if (wallet === null) {
    return undefined;
  }
  return async (message: string) => {
    if (!session.walletsReady) {
      throw new Error("Connect a wallet to view your order history");
    }
    const provider = await wallet.getEthereumProvider();
    const client = createWalletClient({ chain: getAppChain(), transport: custom(provider) });
    return client.signMessage({ account: wallet.address as `0x${string}`, message });
  };
}

function RowButton({
  busy,
  label,
  onClick,
}: {
  busy?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={ROW_BUTTON_CLASSES} disabled={busy} onClick={onClick} type="button">
      {label}
    </button>
  );
}

/** What a tab with no rows says beyond the panel's own copy. */
function emptyStateFor(
  tab: OptionBottomTab,
  hasAccount: boolean,
  series: string,
  signed: { action?: React.ReactNode; body: string; title: string } | undefined
) {
  if (signed !== undefined) {
    return signed;
  }
  if (tab === "order-history" || tab === "trade-history") {
    return undefined;
  }
  if (!hasAccount) {
    return {
      body: `${series} options trade from your account under the futures engine, margined in USDC. Deposit USDC to open it.`,
      title: "No trading account",
    };
  }
  return tab === "positions"
    ? {
        body: "Options you buy will appear here, valued at the engine's mark.",
        title: "No positions",
      }
    : undefined;
}

/**
 * The options page's activity panel, the terminal's own: positions and resting orders across the series' strikes, the
 * account's balances, and the signed history of those strikes.
 */
export function OptionActivityPanel({
  cancellingNonce,
  cash,
  hasAccount,
  onCancel,
  onDeposit,
  onSelect,
  onWithdraw,
  orders,
  positions,
  rows,
  series,
}: {
  cancellingNonce: string | null;
  cash: number | null;
  hasAccount: boolean;
  onCancel: (order: OwnOptionOrder) => void;
  onDeposit: () => void;
  onSelect: (selection: { side: OptionSide; symbol: string }) => void;
  onWithdraw: () => void;
  orders: OwnOptionOrder[];
  positions: OptionPosition[];
  rows: OptionOverviewRow[];
  series: string;
}) {
  const session = useTerminalSession();
  const [tab, setTab] = useState<OptionBottomTab>("positions");
  const units = optionUnitsBySymbol(rows);
  const signedHistory = useSignedHistoryTabs({
    bottomTab: tab,
    isSignedIn: session.isSignedIn,
    signMessage: historySigner(session),
    walletAddress: session.primaryWallet?.address ?? null,
    market: (market) => isOfOptionSeries(market, series),
    orderHistoryView: (items) => buildOptionOrderHistoryView(items, units),
    tradeHistoryView: (items) => buildOptionTradeHistoryView(items, units),
  });

  const views: Record<OptionBottomTab, ActivityView> = {
    balances: buildOptionBalancesView(cash),
    "open-orders": buildOptionOpenOrdersView(orders),
    "order-history": signedHistory.view ?? buildOptionOrderHistoryView([], units),
    positions: buildOptionPositionsView(positions),
    "trade-history": signedHistory.view ?? buildOptionTradeHistoryView([], units),
  };
  const rowActions: Partial<Record<OptionBottomTab, (index: number) => React.ReactNode>> = {
    "trade-history": signedHistory.rowAction,
    balances: () => (
      <span className="inline-flex gap-1.5">
        <RowButton label="Deposit" onClick={onDeposit} />
        {(cash ?? 0) > 0 ? <RowButton label="Withdraw" onClick={onWithdraw} /> : null}
      </span>
    ),
    "open-orders": (index) => {
      const order = orders[index];
      return order === undefined ? null : (
        <RowButton
          busy={cancellingNonce === order.nonce}
          label={cancellingNonce === order.nonce ? "Cancelling…" : "Cancel"}
          onClick={() => onCancel(order)}
        />
      );
    },
    positions: (index) => {
      const position = positions[index];
      return position === undefined ? null : (
        <RowButton
          label="Sell"
          onClick={() => onSelect({ side: "sell", symbol: position.row.symbol })}
        />
      );
    },
  };
  const hasWallet = session.primaryWallet !== null;

  return (
    <TradingActivityPanel
      activityView={views[tab]}
      emptyState={emptyStateFor(tab, hasAccount, series, signedHistory.emptyState)}
      footerLinks={FOOTER_LINKS}
      isSignedIn={session.isSignedIn}
      onTabSelect={(next) => setTab(next as OptionBottomTab)}
      rowAction={hasWallet ? rowActions[tab] : undefined}
      selectedTab={tab}
      tabs={OPTION_BOTTOM_TABS.map((item) => {
        const count = { "open-orders": orders.length, positions: positions.length }[
          item.id as string
        ];
        return count === undefined || !hasWallet
          ? item
          : { ...item, label: `${item.label} (${count})` };
      })}
    />
  );
}
