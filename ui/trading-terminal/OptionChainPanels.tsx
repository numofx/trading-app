"use client";

import { Duration } from "effect";
import posthog from "posthog-js";
import { Fragment, useEffect, useState } from "react";
import { createWalletClient, custom, isAddressEqual } from "viem";
import { formatBalance } from "@/lib/account-balance-display";
import { createBasePublicClient, getAppChain } from "@/lib/base-public-client";
import { impliedVol } from "@/lib/black76";
import { cn } from "@/lib/cn";
import type { FutureStack } from "@/lib/future-market.types";
import { optionSeriesPath } from "@/lib/market-routes";
import type { OwnOptionOrder } from "@/lib/option-activity";
import type { OptionChain, OptionOverviewRow } from "@/lib/option-chain";
import {
  formatExpiryDay,
  formatExpiryTab,
  formatPremium,
  formatTimeToExpiry,
  formatVol,
  optionUnitBase,
} from "@/lib/option-chain";
import type { OptionSeriesPage } from "@/lib/option-chain-read";
import type { OptionSide } from "@/lib/option-order";
import { optionPriceString, optionWorstFeeUnits } from "@/lib/option-order";
import { isOrderFillKnown, pollOrderOutcome } from "@/lib/order-settlement";
import { buildCancelEnvelope, buildSpotOrderEnvelope } from "@/lib/spot-order-submission";
import { getUsdcCngnManagerAddress } from "@/lib/subaccount-deposit-config";
import { SmartLink } from "@/ui/SmartLink";
import { MarketDocumentTitle } from "@/ui/trading-terminal/MarketDocumentTitle";
import { OptionActivityPanel } from "@/ui/trading-terminal/OptionActivityPanel";
import { OptionBookPanel } from "@/ui/trading-terminal/OptionBookPanel";
import type { OptionOrderRequest } from "@/ui/trading-terminal/OptionOrderFormPanel";
import { OptionOrderFormPanel } from "@/ui/trading-terminal/OptionOrderFormPanel";
import { AccountSummary } from "@/ui/trading-terminal/order-form/AccountSummary";
import type { SpotBookTab } from "@/ui/trading-terminal/SpotOrderBookPanel";
import type { HeaderMetricItem } from "@/ui/trading-terminal/TerminalHeaderBar";
import { usePublishTerminalHeader } from "@/ui/trading-terminal/TerminalHeaderSlot";
import { useTerminalSession } from "@/ui/trading-terminal/TerminalSession";
import { useAccountTransfer } from "@/ui/trading-terminal/useAccountTransfer";
import type { OptionAccount } from "@/ui/trading-terminal/useOptionAccount";
import { useOptionAccount } from "@/ui/trading-terminal/useOptionAccount";
import { useOptionSeries } from "@/ui/trading-terminal/useOptionSeries";
import { useOrderStatus } from "@/ui/trading-terminal/useOrderStatus";

const PREMIUM_DECIMALS = 8;

/** Bid IV, bid, mark, ask, ask IV for calls, the strike, then the same five for puts. */
const CHAIN_MIN_WIDTH = "min-w-[800px]";
const CHAIN_GRID = `grid ${CHAIN_MIN_WIDTH} grid-cols-[0.6fr_1fr_1fr_1fr_0.6fr_72px_0.6fr_1fr_1fr_1fr_0.6fr] items-stretch gap-x-1 px-3`;
const CHAIN_FIGURE = "flex items-center text-[13px] text-panel-text tabular-nums";
const CHAIN_HEADERS = ["Bid IV", "Bid", "Mark", "Ask", "Ask IV"] as const;

/** The contract and side the ticket is on. */
type OptionSelection = { side: OptionSide; symbol: string };

/**
 * A resting price, and the way into the ticket: an ask opens a buy of that contract, a bid a sell. The colour is what taking it does, by the one rule for a side: a bid is hit by selling,
 * so it takes the sell colour, and an ask is lifted by buying, so it takes the buy colour.
 */
function PriceCell({
  onSelect,
  selected,
  side,
  value,
}: {
  onSelect: (() => void) | null;
  selected: boolean;
  side: "bid" | "ask";
  value: number | null;
}) {
  const premium = formatPremium(value);
  return (
    <button
      aria-label={
        onSelect === null ? undefined : `${side === "bid" ? "Sell at" : "Buy at"} ${premium}`
      }
      aria-pressed={selected}
      className={cn(
        "my-1 flex cursor-pointer items-center rounded-md px-2 py-1.5 text-left text-[13px] tabular-nums transition-colors disabled:cursor-default",
        premium === "—" && "bg-input-bg text-panel-text-muted hover:bg-input-hover",
        premium !== "—" && side === "bid" && "bg-ask-bg text-ask-text hover:bg-ask-depth",
        premium !== "—" && side === "ask" && "bg-bid-bg text-bid-text hover:bg-bid-depth",
        selected && "ring-1 ring-panel-text-muted"
      )}
      disabled={onSelect === null}
      onClick={onSelect ?? undefined}
      type="button"
    >
      {premium}
    </button>
  );
}

function OptionSideCells({
  forward,
  nowMs,
  onSelect,
  row,
  selection,
}: {
  forward: number | null;
  nowMs: number;
  onSelect: (selection: OptionSelection) => void;
  row: OptionOverviewRow | null;
  selection: OptionSelection | null;
}) {
  // A side the venue does not list, or lists closed, rests nothing: only its mark means anything.
  const open = row?.tradingOpen === true;
  const bid = open ? (row?.bid ?? null) : null;
  const ask = open ? (row?.ask ?? null) : null;
  const pricing =
    row === null || forward === null
      ? null
      : {
          forward,
          isCall: row.optionType === "call",
          seconds: (row.expiryMs - nowMs) / 1000,
          strike: row.strike,
        };
  const vol = (premium: number | null) => (pricing === null ? null : impliedVol(pricing, premium));
  const select = (side: OptionSide) =>
    row === null ? null : () => onSelect({ side, symbol: row.symbol });
  const isSelected = (side: OptionSide) =>
    row !== null && selection?.symbol === row.symbol && selection.side === side;
  return (
    <>
      <span className={CHAIN_FIGURE}>{formatVol(vol(bid))}</span>
      <PriceCell onSelect={select("sell")} selected={isSelected("sell")} side="bid" value={bid} />
      <span className={CHAIN_FIGURE}>{formatPremium(row?.mark ?? null)}</span>
      <PriceCell onSelect={select("buy")} selected={isSelected("buy")} side="ask" value={ask} />
      <span className={CHAIN_FIGURE}>{formatVol(vol(ask))}</span>
    </>
  );
}

/** The dotted rule at the forward, between the strikes either side of it. */
function ForwardRule({ baseSymbol, forward }: { baseSymbol: string; forward: number }) {
  return (
    <div className={cn("relative flex items-center justify-center py-1.5", CHAIN_MIN_WIDTH)}>
      <span className="absolute inset-x-0 border-panel-text-muted border-t border-dotted" />
      <span className="relative rounded-md bg-panel-text-active px-3 py-1 font-medium text-[12px] text-dialog-bg tabular-nums">
        {baseSymbol} forward {formatPremium(forward)}
      </span>
    </div>
  );
}

function OptionChainTable({
  chain,
  nowMs,
  onSelect,
  selection,
}: {
  chain: OptionChain;
  nowMs: number;
  onSelect: (selection: OptionSelection) => void;
  selection: OptionSelection | null;
}) {
  const { forward } = chain;
  const headerClass = "flex items-center py-2 text-[12px] text-panel-text-muted";
  const baseSymbol = chain.baseSymbol || "cNGN";
  const forwardAt =
    forward === null ? -1 : chain.strikes.filter((strike) => strike.strike < forward).length;
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div
        className={cn(
          "grid grid-cols-[1fr_auto_1fr] border-panel-border border-b py-2.5 text-[13px]",
          CHAIN_MIN_WIDTH
        )}
      >
        <span className="text-center font-medium text-panel-text-active">Calls</span>
        <span className="text-center font-medium text-panel-text-active tabular-nums">
          {formatExpiryDay(chain.expiryMs)}{" "}
          <span className="font-normal text-panel-text-muted">
            {formatTimeToExpiry(chain.expiryMs, nowMs)}
          </span>
        </span>
        <span className="text-center font-medium text-panel-text-active">Puts</span>
      </div>
      <div className={cn(CHAIN_GRID, "border-panel-border border-b")}>
        {CHAIN_HEADERS.map((header) => (
          <span className={headerClass} key={`call-${header}`}>
            {header}
          </span>
        ))}
        <span className={cn(headerClass, "justify-center bg-input-bg")}>Strike</span>
        {CHAIN_HEADERS.map((header) => (
          <span className={headerClass} key={`put-${header}`}>
            {header}
          </span>
        ))}
      </div>
      {chain.strikes.map((strike, index) => (
        <Fragment key={strike.strikeLabel}>
          {forward !== null && index === forwardAt ? (
            <ForwardRule baseSymbol={baseSymbol} forward={forward} />
          ) : null}
          <div className={cn(CHAIN_GRID, "border-panel-border border-b")}>
            <OptionSideCells
              forward={forward}
              nowMs={nowMs}
              onSelect={onSelect}
              row={strike.call}
              selection={selection}
            />
            <span className="flex items-center justify-center bg-input-bg text-[13px] text-panel-text-active tabular-nums">
              {strike.strikeLabel}
            </span>
            <OptionSideCells
              forward={forward}
              nowMs={nowMs}
              onSelect={onSelect}
              row={strike.put}
              selection={selection}
            />
          </div>
        </Fragment>
      ))}
      {forward !== null && forwardAt === chain.strikes.length ? (
        <ForwardRule baseSymbol={baseSymbol} forward={forward} />
      ) : null}
    </div>
  );
}

/** One tab per listed series: each is its own page, so a tab is a link. */
function ExpiryTabs({
  active,
  baseSymbol,
  nowMs,
  series,
}: {
  active: string;
  baseSymbol: string;
  nowMs: number;
  series: OptionSeriesPage["series"];
}) {
  const manyBases = new Set(series.map((item) => item.baseSymbol)).size > 1;
  return (
    <div className="flex items-center gap-4 border-panel-border border-b px-4">
      <span className="rounded-md bg-input-bg px-3 py-1.5 font-medium text-[13px] text-panel-text-active">
        {baseSymbol}
      </span>
      <nav aria-label="Expiry" className="flex min-w-0 flex-1 gap-5 overflow-x-auto">
        {series.map((item) => (
          <SmartLink
            aria-current={item.series === active ? "page" : undefined}
            className={cn(
              "-mb-px cursor-pointer whitespace-nowrap border-b-2 py-2.5 text-[13px] transition-colors",
              item.series === active
                ? "border-panel-text-active text-panel-text-active"
                : "border-transparent text-panel-text-muted hover:text-panel-text"
            )}
            href={optionSeriesPath(item.series)}
            key={item.series}
          >
            {manyBases ? `${item.baseSymbol} ` : ""}
            {formatExpiryTab(item.expiryMs, nowMs)}
          </SmartLink>
        ))}
      </nav>
      <span className="shrink-0 text-[12px] text-panel-text-muted">USDC per {baseSymbol}</span>
    </div>
  );
}

const FILL_POLL_INTERVAL_MS = Duration.toMillis("1 second");
const FILL_POLL_TIMEOUT_MS = Duration.toMillis("15 seconds");
/** A market order lapses rather than resting: what the book cannot fill now is not left on it. */
const MARKET_ORDER_LIFETIME_SECONDS = Duration.toSeconds("2 minutes");
const CLOCK_TICK_MS = Duration.toMillis("1 second");

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

type Wallet = NonNullable<ReturnType<typeof useTerminalSession>["primaryWallet"]>;
type OrderStatus = ReturnType<typeof useOrderStatus>;

async function walletClientFor(wallet: Wallet) {
  const chain = getAppChain();
  await wallet.switchChain(chain.id);
  return createWalletClient({ chain, transport: custom(await wallet.getEthereumProvider()) });
}

/** Signs an option order for the strike's asset and series and posts it. */
async function signAndPostOptionOrder({
  onAwaitingSignature,
  request,
  row,
  subaccountId,
  wallet,
}: {
  onAwaitingSignature: () => void;
  request: OptionOrderRequest;
  row: OptionOverviewRow;
  subaccountId: string;
  wallet: Wallet;
}) {
  const { stack, amountScale, takerFeeBps } = row;
  if (stack === null || amountScale === null || takerFeeBps === null) {
    throw new Error("The venue has not named this option's terms in full. Try again shortly.");
  }
  const lastTrade = row.lastTradeAtMs === null ? null : Math.floor(row.lastTradeAtMs / 1000);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const envelope = buildSpotOrderEnvelope({
    expiry:
      request.orderType === "Limit" && lastTrade !== null
        ? lastTrade
        : Math.min(
            nowSeconds + MARKET_ORDER_LIFETIME_SECONDS,
            lastTrade ?? Number.MAX_SAFE_INTEGER
          ),
    side: request.side,
    market: {
      amountScale: BigInt(amountScale),
      assetAddress: stack.assetAddress,
      orderIdPrefix: "option",
      subId: stack.subId,
      tradeModuleAddress: stack.tradeModuleAddress,
      worstFeeUnits: optionWorstFeeUnits({
        bestBid: row.bid,
        limit: request.price,
        side: request.side,
        takerFeeBps,
      }),
    },
    subaccountId,
    uiPrice: optionPriceString(request.price),
    uiSize: String(request.units),
    walletAddress: wallet.address,
  });
  const walletClient = await walletClientFor(wallet);
  onAwaitingSignature();
  const signature = await walletClient.signTypedData({
    account: wallet.address as `0x${string}`,
    ...envelope.typedData,
  });
  const response = await fetch("/api/orders", {
    body: JSON.stringify({ ...envelope.payload, signature }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return { error: body?.error ?? null, ok: response.ok, orderId: envelope.payload.order_id };
}

async function readOrder(orderId: string) {
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      cache: "no-store",
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function nextBlock() {
  try {
    return (await createBasePublicClient().getBlockNumber()) + 1n;
  } catch {
    return null;
  }
}

type OwnOrder = OwnOptionOrder;

function ownOrders(rows: OptionOverviewRow[], wallet: string | null): OwnOrder[] {
  if (wallet === null) {
    return [];
  }
  return rows.flatMap((row) =>
    row.openOrders
      .filter((order) => order.ownerAddress.toLowerCase() === wallet.toLowerCase())
      .map((order) => ({ ...order, row }))
  );
}

function chainRows(chain: OptionChain | null) {
  return (chain?.strikes ?? []).flatMap((strike) =>
    [strike.call, strike.put].filter((row): row is OptionOverviewRow => row !== null)
  );
}

/** Until one is chosen the ticket opens on buying the call nearest the forward. */
function defaultContract(chain: OptionChain | null) {
  const forward = chain?.forward ?? null;
  const strikes = chain?.strikes ?? [];
  const nearest =
    forward === null
      ? strikes[0]
      : [...strikes].sort(
          (left, right) => Math.abs(left.strike - forward) - Math.abs(right.strike - forward)
        )[0];
  return nearest?.call ?? nearest?.put ?? null;
}

/** What the account holds of a strike, signed, in base units. */
function optionHolding(account: OptionAccount | null, row: OptionOverviewRow) {
  const { stack } = row;
  if (stack === null || account === null) {
    return 0;
  }
  const held = account.rows.find(
    (item) => isAddressEqual(item.asset, stack.assetAddress) && item.subId === BigInt(stack.subId)
  );
  return held === undefined ? 0 : Number(held.balance) / 1e18;
}

/** Unfilled resting sells of a strike, in base units. */
function restingSellsOf(orders: readonly OwnOrder[], row: OptionOverviewRow) {
  const unit = optionUnitBase(row.amountScale ?? undefined) ?? 1;
  return orders
    .filter((order) => order.row.symbol === row.symbol && order.side === "sell")
    .reduce((sum, order) => sum + (order.size - order.filled) * unit, 0);
}

function headerMetrics(chain: OptionChain | null, nowMs: number): HeaderMetricItem[] {
  return [
    {
      label: "Forward",
      tone: null,
      tooltip: "The forward the engine prices this expiry on, in USDC per cNGN.",
      value: formatPremium(chain?.forward ?? null),
    },
    { label: "Expiry", tone: null, value: chain === null ? "—" : formatExpiryDay(chain.expiryMs) },
    {
      label: "Time to expiry",
      tone: null,
      value: chain === null ? "—" : formatTimeToExpiry(chain.expiryMs, nowMs),
    },
    { label: "Strikes", tone: null, value: chain === null ? "—" : `${chain.strikes.length}` },
  ];
}

/** Follows an accepted order until its fill is known. True when it filled; an order ended without one says so. */
async function followOptionFill(orderId: string, orderStatus: OrderStatus) {
  const outcome = await pollOrderOutcome(() => readOrder(orderId), {
    intervalMs: FILL_POLL_INTERVAL_MS,
    timeoutMs: FILL_POLL_TIMEOUT_MS,
    until: isOrderFillKnown,
  });
  if (Number.parseFloat(outcome?.filled_amount ?? "0") > 0) {
    return true;
  }
  if (outcome?.status === "cancelled" || outcome?.status === "expired") {
    const reason = outcome.cancel_reason ? ` (${outcome.cancel_reason.replaceAll("_", " ")})` : "";
    orderStatus.settle(`Order ${outcome.status} without a fill${reason}.`);
  }
  return false;
}

async function signAndPostCancel(wallet: Wallet, order: OwnOrder) {
  const envelope = buildCancelEnvelope({
    nonce: order.nonce,
    ownerAddress: order.ownerAddress,
    signerAddress: wallet.address,
  });
  const walletClient = await walletClientFor(wallet);
  const signature = await walletClient.signTypedData({
    account: wallet.address as `0x${string}`,
    ...envelope.typedData,
  });
  return await fetch("/api/orders/cancel", {
    body: JSON.stringify({ ...envelope.payload, signature }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function useOptionOrderActions({
  contract,
  onAccountChanged,
  onBookChanged,
  orderStatus,
  subaccountId,
  wallet,
}: {
  contract: OptionOverviewRow | null;
  onAccountChanged: (minBlock: bigint | null) => void;
  onBookChanged: () => void;
  orderStatus: OrderStatus;
  subaccountId: string | null;
  wallet: Wallet | null;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancellingNonce, setCancellingNonce] = useState<string | null>(null);

  async function submit(request: OptionOrderRequest) {
    if (contract === null || wallet === null || subaccountId === null) {
      return;
    }
    const event = {
      market_id: contract.symbol.toLowerCase(),
      order_side: request.side,
      order_type: request.orderType,
    };
    setIsSubmitting(true);
    try {
      const posted = await signAndPostOptionOrder({
        onAwaitingSignature: () =>
          orderStatus.announce(`Awaiting wallet signature for account #${subaccountId}`),
        request,
        row: contract,
        subaccountId,
        wallet,
      });
      if (!posted.ok) {
        posthog.capture("order_rejected", { ...event, error_message: posted.error });
        orderStatus.settle(posted.error ?? "Option order submission failed");
        return;
      }
      posthog.capture("order_submitted", { ...event, order_id: posted.orderId });
      orderStatus.announce(null, { awaitFill: true });
      onBookChanged();
      if (await followOptionFill(posted.orderId, orderStatus)) {
        onAccountChanged(await nextBlock());
      }
      onBookChanged();
    } catch (error) {
      posthog.captureException(error, { properties: { market_id: event.market_id } });
      orderStatus.settle(error instanceof Error ? error.message : "Option order submission failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function cancel(order: OwnOrder) {
    if (wallet === null) {
      return;
    }
    setCancellingNonce(order.nonce);
    try {
      const response = await signAndPostCancel(wallet, order);
      orderStatus.settle(response.ok ? "Order cancelled." : `Cancel failed (${response.status})`);
      onBookChanged();
    } catch (error) {
      orderStatus.settle(error instanceof Error ? error.message : "Cancel failed");
    } finally {
      setCancellingNonce(null);
    }
  }

  return { cancel, cancellingNonce, isSubmitting, submit };
}

function ChainSection({
  failed,
  nowMs,
  onSelect,
  page,
  readAtMs,
  selection,
  series,
}: {
  failed: boolean;
  nowMs: number;
  onSelect: (selection: OptionSelection) => void;
  page: OptionSeriesPage | null;
  readAtMs: number;
  selection: OptionSelection | null;
  series: string;
}) {
  const chain = page?.chain ?? null;
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-panel-bg-muted ring-1 ring-panel-ring">
      {chain === null || page === null ? (
        <p className="py-16 text-center text-[13px] text-panel-text-muted">
          {failed || page !== null
            ? `${series} options could not be read right now`
            : `Loading ${series} options`}
        </p>
      ) : (
        <>
          <ExpiryTabs
            active={series}
            baseSymbol={chain.baseSymbol || "cNGN"}
            nowMs={nowMs}
            series={page.series}
          />
          <OptionChainTable
            chain={chain}
            nowMs={readAtMs}
            onSelect={onSelect}
            selection={selection}
          />
        </>
      )}
    </section>
  );
}

/**
 * The account the session resolves lives under this manager; an option under another cannot be held by it, so the
 * ticket then has no account to sign from.
 */
function usableAccount(stack: FutureStack | null, subaccountId: string | null) {
  return stack !== null && isAddressEqual(stack.managerAddress, getUsdcCngnManagerAddress())
    ? subaccountId
    : null;
}

/** The contract and side the ticket is on: the one chosen while it is listed, else the default. */
function resolveSelection(
  rows: readonly OptionOverviewRow[],
  chain: OptionChain | null,
  selection: OptionSelection | null
) {
  const chosen = rows.find((row) => row.symbol === selection?.symbol) ?? null;
  return chosen === null || selection === null
    ? { contract: defaultContract(chain), side: "buy" as OptionSide }
    : { contract: chosen, side: selection.side };
}

function OptionAccountRows({
  account,
  transfer,
}: {
  account: OptionAccount | null;
  transfer: ReturnType<typeof useAccountTransfer>;
}) {
  return (
    <AccountSummary
      rows={[
        {
          balance: formatBalance(account?.cash ?? null, "USDC"),
          onWithdraw: account === null ? undefined : () => transfer.openWithdraw("USDC"),
          symbol: "USDC",
          onDeposit: () => transfer.openDeposit("USDC"),
        },
      ]}
    />
  );
}

/**
 * A series' options page: its chain, a ticket on the contract chosen from it, and the account's positions and
 * resting orders. Everything trades from the wallet's one trading account under the MarginEngine.
 */
export function OptionChainPanels({ series }: { series: string }) {
  const { failed, page, readAtMs, refresh: refreshChain } = useOptionSeries(series);
  const session = useTerminalSession();
  const wallet = session.primaryWallet;
  const nowMs = useNow();
  const chain = page?.chain ?? null;
  const rows = chainRows(chain);
  const [selection, setSelection] = useState<OptionSelection | null>(null);
  const [bookTab, setBookTab] = useState<SpotBookTab>("book");

  const { contract, side } = resolveSelection(rows, chain, selection);
  const stack = contract?.stack ?? null;
  const subaccountId = usableAccount(stack, session.account.subaccountId);
  const { account, refresh: refreshAccount } = useOptionAccount(
    subaccountId,
    stack?.cashAddress ?? null,
    stack?.managerAddress ?? null
  );
  const orderStatus = useOrderStatus(
    (account?.rows ?? []).map((row) => `${row.subId}:${row.balance}`).join(",")
  );
  const transfer = useAccountTransfer({
    accountRows: account?.rows ?? null,
    depositPauseReasons: {
      cNGN: `${series} options are margined in USDC only.`,
      EURC: `${series} options are margined in USDC only.`,
    },
    onTransferred: (block) => refreshAccount(block),
  });
  const actions = useOptionOrderActions({
    contract,
    onAccountChanged: refreshAccount,
    onBookChanged: refreshChain,
    orderStatus,
    subaccountId,
    wallet,
  });
  const positions = rows
    .map((row) => ({ row, size: optionHolding(account, row) }))
    .filter((position) => position.size !== 0);
  const orders = ownOrders(rows, wallet?.address ?? null);

  function select(next: OptionSelection) {
    orderStatus.clear();
    setSelection(next);
  }

  usePublishTerminalHeader({
    changePercent24h: null,
    depositControl: transfer.headerControl,
    high24h: null,
    low24h: null,
    market: "option",
    metrics: headerMetrics(chain, nowMs),
    price: chain?.forward ?? null,
    volume24hLabel: "—",
  });

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 md:min-h-0 md:flex-row md:overflow-hidden md:px-4">
      <MarketDocumentTitle
        digits={PREMIUM_DECIMALS}
        pair={`${series} options`}
        price={chain?.forward ?? null}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3 md:min-h-0">
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ChainSection
              failed={failed}
              nowMs={nowMs}
              onSelect={select}
              page={page}
              readAtMs={readAtMs}
              selection={contract === null ? null : { side, symbol: contract.symbol }}
              series={series}
            />
          </div>
          <div className="w-full shrink-0 md:h-full md:w-[270px] 2xl:w-[300px]">
            {contract === null ? null : (
              <OptionBookPanel
                key={contract.symbol}
                onTabChange={setBookTab}
                row={contract}
                tab={bookTab}
              />
            )}
          </div>
        </div>
        <div className="h-[260px] shrink-0 md:h-[26%] md:min-h-[190px]">
          <OptionActivityPanel
            cancellingNonce={actions.cancellingNonce}
            cash={account?.cash ?? null}
            hasAccount={subaccountId !== null}
            onCancel={(order) => void actions.cancel(order)}
            onDeposit={() => transfer.openDeposit("USDC")}
            onSelect={select}
            onWithdraw={() => transfer.openWithdraw("USDC")}
            orders={orders}
            positions={positions}
            rows={rows}
            series={series}
          />
        </div>
      </div>
      <div className="flex w-full shrink-0 flex-col gap-3 md:w-[320px] md:overflow-y-auto">
        {contract === null ? null : (
          <OptionOrderFormPanel
            cash={account?.cash ?? null}
            forward={chain?.forward ?? null}
            hasAccount={subaccountId !== null}
            hasWallet={wallet !== null}
            isAccepted={orderStatus.isAccepted}
            isFilled={orderStatus.isFilled}
            isPreparingAccount={
              session.account.isLoading || (session.isSignedIn && !session.walletsReady)
            }
            isSubmitting={actions.isSubmitting}
            key={contract.symbol}
            lastAction={orderStatus.isFilled ? null : orderStatus.status}
            nowMs={nowMs}
            onConnect={session.login}
            onDepositRequest={() => transfer.openDeposit("USDC")}
            onEdit={orderStatus.clear}
            onSideChange={(next) => setSelection({ side: next, symbol: contract.symbol })}
            onSubmit={(request) => void actions.submit(request)}
            position={optionHolding(account, contract)}
            restingSells={restingSellsOf(orders, contract)}
            row={contract}
            side={side}
            surplus={account?.initialMarginSurplus ?? null}
          />
        )}
        <OptionAccountRows account={account} transfer={transfer} />
      </div>
    </div>
  );
}
