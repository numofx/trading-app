"use client";

import { Duration } from "effect";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import { createWalletClient, custom } from "viem";
import { getAppChain } from "@/lib/base-public-client";
import { formatUsdcPrice } from "@/lib/market-formatting";
import { MARKET_LABELS } from "@/lib/market-labels";
import type { OrderOutcome } from "@/lib/order-settlement";
import { pollOrderOutcome } from "@/lib/order-settlement";
import { getMarketableLimitPrice } from "@/lib/spot-market";
import type { OrderMarketOverride } from "@/lib/spot-order-submission";
import {
  buildCancelEnvelope,
  buildSpotOrderEnvelope,
  SPOT_ORDER_LIFETIME_LABEL,
} from "@/lib/spot-order-submission";
import type { DepositCurrency } from "@/lib/subaccount-deposit.types";
import {
  getCngnTokenAddress,
  getFirstDepositableCurrency,
  getLegacySpotStack,
  getUsdcTokenAddress,
} from "@/lib/subaccount-deposit-config";
import { getAccountLegs } from "@/lib/subaccount-ledger";
import type { SpotMarket } from "@/lib/trading.types";
import type { WithdrawableAsset } from "@/lib/withdrawable-assets";
import type { TransferMode } from "@/ui/trading-terminal/DepositDialog";
import { buildDepositAccount, DepositDialog } from "@/ui/trading-terminal/DepositDialog";
import { MarketDocumentTitle } from "@/ui/trading-terminal/MarketDocumentTitle";
import { SpotTradingTerminal } from "@/ui/trading-terminal/SpotTradingTerminal";
import { useTerminalSession } from "@/ui/trading-terminal/TerminalSession";
import { useOrderStatus } from "@/ui/trading-terminal/useOrderStatus";
import {
  formatSubaccountCngnLabel,
  formatSubaccountUsdcLabel,
  toLedgerAmount,
  useSubaccountBalance,
} from "@/ui/trading-terminal/useSubaccountBalance";
import { useTradingSubaccount } from "@/ui/trading-terminal/useTradingSubaccount";

type SpotExecutionPrice = { error: string } | { price: string };

/** The touch as displayed in the ladder at the moment the trader submitted. */
type SubmittedBook = { bestAsk: number | null; bestBid: number | null };

/**
 * Market spot orders cross the opposing side of the book; every other order type executes at the
 * entered price. Returns the operator-facing copy rather than throwing, so a missing book side
 * reads the same as it did inline.
 *
 * The touch comes from the terminal — the book the trader was looking at — not from this
 * component's server-rendered snapshot. A terminal stays open for hours, and pricing a market
 * order off page-load depth sends a limit that no longer crosses: the order rests instead of
 * filling, which is the one thing a market order is not supposed to do.
 */
function resolveSpotExecutionPrice(
  orderType: "Limit" | "Market",
  side: "buy" | "sell",
  book: SubmittedBook,
  enteredPrice: string
): SpotExecutionPrice {
  if (orderType !== "Market") {
    return { price: enteredPrice };
  }

  // Signed through the touch rather than at it, so a quote that moves in the interim does not
  // turn the market order into a resting limit. The fill still happens at the maker's price. The
  // ticket has already sized the order in cNGN at its expected fill, so the limit is all that is
  // needed here. Ten places, never `String()`: a USDC-per-cNGN price is small enough that
  // `String` can print it in scientific notation, which the envelope's parser rejects.
  const marketable = getMarketableLimitPrice(side, book.bestAsk, book.bestBid);

  if (marketable === null) {
    return { error: "No opposing spot liquidity to cross. Use a limit order." };
  }

  return { price: marketable.toFixed(10) };
}

/**
 * Whether the ticket should read "Loading account…" rather than offering to trade.
 *
 * Covers two waits: the subaccount lookup, and the gap where Privy reports a session before
 * `useWallets` has produced its embedded wallet. The second one matters because the ticket gates
 * on the wallet — without this it would send a signed-in user to the deposit dialog mid-login.
 *
 * Lives outside the component to keep its branching off that function's complexity budget.
 */
function isPreparingTradingAccount({
  isResolvingSubaccount,
  isSignedIn,
  walletsReady,
}: {
  isResolvingSubaccount: boolean;
  isSignedIn: boolean;
  walletsReady: boolean;
}) {
  return isResolvingSubaccount || (isSignedIn && !walletsReady);
}

type SignedOrderResponse = {
  body: { error?: string; order?: { order_id?: string } } | null;
  ok: boolean;
  status: number;
};

/** POSTs a signed envelope to the order API, tolerating a non-JSON error body. */
async function postSignedOrder(payload: object, signature: string): Promise<SignedOrderResponse> {
  const response = await fetch("/api/orders", {
    body: JSON.stringify({ ...payload, signature }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as SignedOrderResponse["body"];

  return { body, ok: response.ok, status: response.status };
}

// An order rests in `active_orders` a few seconds after it is accepted; poll the per-order status
// across that window so the book refresh lands after the order exists, not before.
const ORDER_SETTLE_POLL_INTERVAL_MS = Duration.toMillis("1 second");
const ORDER_SETTLE_TIMEOUT_MS = Duration.toMillis("8 seconds");

/**
 * What the venue did with the order, in the trader's terms.
 *
 * "Accepted" only means the order reached the book. It filled, is resting, or expired unfilled —
 * and the terminal used to echo the submitted limit price back as though it were a fill price. It
 * deliberately does not quote a price: the order-status response carries amounts and a status but
 * no execution price, and inventing one is how the limit came to be reported as the fill.
 */
function describeOrderOutcome(outcome: OrderOutcome | null, size: string, price: string) {
  const at = formatUsdcPrice(Number(price));
  if (outcome?.status === "filled") {
    return `Filled ${size} cNGN. Balances updated.`;
  }
  if (outcome?.status === "expired") {
    return `Order expired unfilled at ${at}.`;
  }
  if (outcome?.status === "cancelled") {
    return "Order cancelled.";
  }
  if (outcome?.status === "active") {
    const filled = Number(outcome.filled_amount ?? "0");
    return filled > 0
      ? `Partly filled, the rest resting at ${at}. Expires ${SPOT_ORDER_LIFETIME_LABEL} after signing.`
      : `Resting at ${at}. Expires ${SPOT_ORDER_LIFETIME_LABEL} after signing, or cancel it from Open Orders.`;
  }
  // No status yet: say what is certain rather than claiming a fill.
  return `Order accepted at ${at}. Check Open Orders for its status.`;
}

/** Reads the order back so the terminal reports what happened, not what was asked for. */
async function readOrderOutcome(orderId: string): Promise<OrderOutcome | null> {
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as OrderOutcome;
  } catch {
    return null;
  }
}

/** Properties shared by every spot order analytics event. */
function buildSpotOrderEvent(
  side: "buy" | "sell",
  orderType: "Limit" | "Market",
  size: string,
  executionPrice: string
) {
  return {
    limit_price: executionPrice,
    market_id: "cngn-usdc-spot",
    order_side: side,
    order_type: orderType,
    size_cngn: size,
  };
}

/** What a fill changes on spot: the trading account's ledger, by asset. */
function balanceSignature(rows: { asset: string; balance: bigint }[] | null) {
  return rows === null ? "" : rows.map((row) => `${row.asset}:${row.balance}`).join("|");
}

/** The header's Deposit and Withdraw buttons share one look. */
const HEADER_ACTION_CLASSES =
  "flex h-10 cursor-pointer items-center whitespace-nowrap rounded-sm bg-input-bg px-4 font-semibold text-[14px] text-panel-text ring-1 ring-panel-border transition-colors hover:bg-input-hover hover:text-panel-text-active disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The spot market under the shell: its panels, ticket, deposit dialog and the signing behind
 * them. The session (wallet, trading account, wallet balances) is the shell's, so a switch to the
 * perp and back keeps it; everything here is the market's own and remounts with it.
 */
export function SpotMarketPanels({ spotMarket }: { spotMarket: SpotMarket }) {
  // `null` until something actually happens — an idle placeholder would occupy
  // footer space in the order ticket without telling the trader anything.
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const router = useRouter();

  const {
    account: {
      adoptSubaccountId,
      ensureTradingSubaccount,
      isLoading: isResolvingTradingSubaccount,
      isResolved: isTradingSubaccountResolved,
      subaccountId: tradingSubaccountId,
    },
    isSignedIn,
    login,
    primaryWallet,
    refreshWalletBalances,
    selectWallet,
    walletBalances,
    wallets,
    walletsReady,
  } = useTerminalSession();
  // The header hosts the one deposit dialog; the order ticket opens it through this state.
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositMode, setDepositMode] = useState<TransferMode>("deposit");
  // Which asset it opens on. Held here rather than inside the dialog because the ticket names the
  // currency when it sends the trader over — a "Deposit cNGN" button must not land on the USDC form.
  const [depositCurrency, setDepositCurrency] = useState<DepositCurrency>(
    getFirstDepositableCurrency
  );
  const [resumeDepositAfterLogin, setResumeDepositAfterLogin] = useState(false);
  /*
   * The ticket gates on the wallet rather than the session because a session can exist before its
   * embedded wallet does: an email login is authenticated while Privy is still provisioning one.
   */
  const hasWallet = primaryWallet !== null;
  const depositAccount = buildDepositAccount(primaryWallet, tradingSubaccountId);
  const isPreparingAccount = isPreparingTradingAccount({
    isResolvingSubaccount: isResolvingTradingSubaccount,
    isSignedIn,
    walletsReady,
  });
  const { balance: subaccountBalance, refresh: refreshSubaccountBalance } =
    useSubaccountBalance(tradingSubaccountId);
  const orderStatus = useOrderStatus(balanceSignature(subaccountBalance?.rows ?? null));
  // The spot stack retired by the unified cutover: the wallet's account there is withdraw-only.
  const legacyStack = getLegacySpotStack();
  const legacyAccount = useTradingSubaccount(
    legacyStack === null ? null : (primaryWallet?.address ?? null),
    legacyStack === null
      ? undefined
      : { depositAsset: legacyStack.usdcEscrow, manager: legacyStack.manager }
  );
  const { balance: legacyBalance, refresh: refreshLegacyBalance } = useSubaccountBalance(
    legacyAccount.subaccountId
  );
  const [legacyWithdrawOpen, setLegacyWithdrawOpen] = useState(false);
  const legacy = buildLegacySpotView(
    legacyStack,
    legacyAccount.subaccountId,
    legacyBalance?.rows ?? null,
    spotMarket.mark
  );
  // A wallet with no trading account holds zero, not an unknown amount, so the ticket's shortfall
  // check can stop an order that would otherwise be signed against an empty account.
  const accountLegs = getAccountLegs({
    balance: subaccountBalance,
    isAccountResolved: isTradingSubaccountResolved,
    subaccountId: tradingSubaccountId,
  });

  /**
   * Re-reads every balance a transfer moves, at or past the transfer's block. Reading latest instead
   * could hit an RPC node a block behind and leave the pre-transfer figures on screen.
   */
  function refreshBalancesAfter(blockNumber: bigint | null) {
    refreshWalletBalances(blockNumber);
    refreshSubaccountBalance(blockNumber);
  }

  function handleDeposited(depositedSubaccountId: string, blockNumber: bigint | null) {
    adoptSubaccountId(depositedSubaccountId);
    refreshBalancesAfter(blockNumber);
  }

  /**
   * Base UI dialogs are modal, so Privy's login modal would render inert behind this one. The
   * deposit dialog steps aside for the login and an effect brings it back once a wallet lands.
   */
  function handleConnectWallet() {
    setDepositOpen(false);
    setResumeDepositAfterLogin(true);
    login();
  }

  useEffect(() => {
    if (resumeDepositAfterLogin && primaryWallet !== null) {
      setResumeDepositAfterLogin(false);
      setDepositOpen(true);
    }
  }, [primaryWallet, resumeDepositAfterLogin]);

  // Candles come from the venue's own fills via markets-service; there is no
  // client-side ticking. A random walk here would overwrite real price history
  // with invented movement.

  async function handleSubmitSpot({
    side,
    price,
    size,
    orderType,
    book,
  }: {
    side: "buy" | "sell";
    price: string;
    size: string;
    orderType: "Limit" | "Market";
    book: SubmittedBook;
  }) {
    if (!walletsReady) {
      orderStatus.announce("Wallet is still loading");
      return;
    }
    if (!primaryWallet?.address) {
      orderStatus.announce("Connect a wallet before submitting an order");
      return;
    }
    const resolvedPrice = resolveSpotExecutionPrice(orderType, side, book, price);

    if ("error" in resolvedPrice) {
      orderStatus.announce(resolvedPrice.error);
      return;
    }

    const executionPrice = resolvedPrice.price;

    try {
      setIsSubmittingOrder(true);
      orderStatus.announce(
        tradingSubaccountId
          ? `Submitting spot order on trading account #${tradingSubaccountId}`
          : "Preparing trading account..."
      );
      const resolvedTradingSubaccountId =
        tradingSubaccountId ?? (await ensureTradingSubaccount(primaryWallet));

      const appChain = getAppChain();
      await primaryWallet.switchChain(appChain.id);
      const provider = await primaryWallet.getEthereumProvider();
      const walletClient = createWalletClient({ chain: appChain, transport: custom(provider) });

      const envelope = buildSpotOrderEnvelope({
        market: servedOrderMarket(spotMarket),
        side,
        subaccountId: resolvedTradingSubaccountId,
        uiPrice: executionPrice,
        uiSize: size,
        walletAddress: primaryWallet.address,
      });
      orderStatus.announce(
        `Awaiting wallet signature for trading account #${resolvedTradingSubaccountId}`
      );
      const signature = await walletClient.signTypedData({
        account: primaryWallet.address as `0x${string}`,
        ...envelope.typedData,
      });
      const { body, ok, status } = await postSignedOrder(envelope.payload, signature);

      if (!ok) {
        posthog.capture("order_rejected", {
          ...buildSpotOrderEvent(side, orderType, size, executionPrice),
          error_message: body?.error ?? null,
          http_status: status,
        });
        orderStatus.settle(body?.error ?? "Spot order submission failed");
        return;
      }
      posthog.capture("order_submitted", {
        ...buildSpotOrderEvent(side, orderType, size, executionPrice),
        order_id: body?.order?.order_id ?? null,
      });
      orderStatus.announce("Order accepted. Checking whether it filled…", { awaitFill: true });
      // Poll until the venue has recorded the order, so the refresh below fetches a book that lists
      // it. A resting order reaches `active_orders` a few seconds after acceptance, and the book
      // reads that same store — refreshing before it lands left Open Orders empty until a later
      // render happened to catch up.
      const outcome = await pollOrderOutcome(() => readOrderOutcome(envelope.payload.order_id), {
        intervalMs: ORDER_SETTLE_POLL_INTERVAL_MS,
        timeoutMs: ORDER_SETTLE_TIMEOUT_MS,
      });
      orderStatus.settle(describeOrderOutcome(outcome, size, executionPrice));
      // Read balances after the outcome, not before it: refreshing on acceptance alone showed the
      // pre-fill account and left the strip disagreeing with the trade that had just happened.
      refreshWalletBalances();
      refreshSubaccountBalance();
      // Re-runs the server render, so an order that rested shows up in the book and in Open Orders
      // instead of leaving the terminal looking exactly as it did before the trade.
      router.refresh();
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Spot order submission failed";
      posthog.captureException(error, {
        properties: { market_id: "cngn-usdc-spot", order_side: side, order_type: orderType },
      });
      orderStatus.settle(errorMessage);
      return;
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  /**
   * Signs and submits a cancel for one of this trader's resting orders.
   *
   * markets-service authorizes a cancel on a signature over Cancel(owner, signer, nonce, expiry),
   * not on the public (owner_address, nonce) pair alone, so cancelling — like submitting — goes
   * through the wallet. Returns the outcome rather than touching UI state; the activity panel owns
   * the per-row cancelling/error state and the server refresh.
   */
  async function handleCancelSpot(
    nonce: string,
    ownerAddress: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (!walletsReady || primaryWallet === null) {
      return { error: "Connect a wallet before cancelling an order", ok: false };
    }
    try {
      const appChain = getAppChain();
      await primaryWallet.switchChain(appChain.id);
      const provider = await primaryWallet.getEthereumProvider();
      const walletClient = createWalletClient({ chain: appChain, transport: custom(provider) });

      const envelope = buildCancelEnvelope({
        nonce,
        ownerAddress,
        signerAddress: primaryWallet.address,
      });
      const signature = await walletClient.signTypedData({
        account: primaryWallet.address as `0x${string}`,
        ...envelope.typedData,
      });

      const response = await fetch("/api/orders/cancel", {
        body: JSON.stringify({ ...envelope.payload, signature }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        return { error: body?.error ?? `Cancel failed (${response.status})`, ok: false };
      }
      return { ok: true };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Cancel failed", ok: false };
    }
  }

  /**
   * Signs the order-history login with personal_sign. Unlike an order or a cancel it authorizes
   * nothing on chain, so there is no chain to switch to; the wallet shows the plain-text message.
   */
  async function handleSignOrderHistory(message: string) {
    if (!walletsReady || primaryWallet === null) {
      throw new Error("Connect a wallet to view your order history");
    }
    const provider = await primaryWallet.getEthereumProvider();
    const walletClient = createWalletClient({ chain: getAppChain(), transport: custom(provider) });
    return walletClient.signMessage({
      account: primaryWallet.address as `0x${string}`,
      message,
    });
  }

  return (
    <>
      <MarketDocumentTitle pair={MARKET_LABELS["cNGN-USDC"]} price={spotMarket.mark} />

      <SpotTradingTerminal
        accountCngn={toLedgerAmount(accountLegs.cngnUnits)}
        accountUsdc={toLedgerAmount(accountLegs.cashUnits)}
        candles={spotMarket.candles}
        depositControl={
          // Deposit opens the dialog on its own trigger; Withdraw is a second door into the same
          // dialog, opened on its Withdraw side.
          <div className="flex items-center gap-2">
            <DepositDialog
              account={depositAccount}
              accountRows={subaccountBalance?.rows ?? null}
              currency={depositCurrency}
              fundingWallets={isSignedIn ? wallets : []}
              mode={depositMode}
              onConnectWallet={handleConnectWallet}
              onCurrencyChange={setDepositCurrency}
              onDeposited={handleDeposited}
              onModeChange={setDepositMode}
              onOpenChange={setDepositOpen}
              onSelectFundingWallet={(wallet) => selectWallet(wallet.address)}
              onWithdrawn={refreshBalancesAfter}
              open={depositOpen}
              triggerClassName={HEADER_ACTION_CLASSES}
              triggerId="header-deposit-trigger"
              walletBalances={{ cNGN: walletBalances.cngn, USDC: walletBalances.usdc }}
            />
            <button
              className={HEADER_ACTION_CLASSES}
              id="header-withdraw-trigger"
              onClick={() => {
                setDepositMode("withdraw");
                setDepositOpen(true);
              }}
              type="button"
            >
              Withdraw
            </button>
          </div>
        }
        hasWallet={hasWallet}
        isPreparingAccount={isPreparingAccount}
        isSignedIn={isSignedIn}
        isSubmitting={isSubmittingOrder}
        lastAction={orderStatus.status}
        legacy={legacy}
        legacyControl={
          legacy === null || legacyStack === null ? null : (
            <DepositDialog
              account={buildDepositAccount(primaryWallet, legacy.accountId)}
              accountRows={legacyBalance?.rows ?? null}
              onDeposited={() => undefined}
              onOpenChange={setLegacyWithdrawOpen}
              onWithdrawn={(blockNumber) => {
                refreshLegacyBalance(blockNumber);
                refreshWalletBalances();
              }}
              open={legacyWithdrawOpen}
              triggerClassName="cursor-pointer rounded-sm bg-input-bg px-2 py-1 font-medium text-[11px] text-panel-text ring-1 ring-panel-border transition-colors hover:text-panel-text-active"
              triggerId="legacy-spot-withdraw-trigger"
              withdrawableAssets={legacyWithdrawableAssets(legacyStack)}
              withdrawOnly
            />
          )
        }
        onCancelOrder={handleCancelSpot}
        onDepositRequest={(currency) => {
          if (currency !== undefined) {
            setDepositCurrency(currency);
          }
          setDepositMode("deposit");
          setDepositOpen(true);
        }}
        onFormEdit={orderStatus.clear}
        onSignOrderHistory={handleSignOrderHistory}
        onSubmitOrder={handleSubmitSpot}
        onWithdrawRequest={(currency) => {
          setDepositCurrency(currency);
          setDepositMode("withdraw");
          setDepositOpen(true);
        }}
        spotMarket={spotMarket}
        walletAddress={primaryWallet?.address ?? null}
      />
    </>
  );
}

/** The retired spot stack's escrows as withdrawable assets, paying out the same tokens as today. */
function legacyWithdrawableAssets(stack: {
  usdcEscrow: `0x${string}`;
  cngnEscrow: `0x${string}`;
}): WithdrawableAsset[] {
  return [
    {
      escrow: stack.usdcEscrow,
      id: "legacy-usdc",
      label: "USDC (old spot account)",
      symbol: "USDC",
      token: getUsdcTokenAddress(),
    },
    {
      escrow: stack.cngnEscrow,
      id: "legacy-cngn",
      label: "cNGN (old spot account)",
      symbol: "cNGN",
      token: getCngnTokenAddress(),
    },
  ];
}

/**
 * What the Assets tab shows for the wallet's account on the retired spot stack, or null when there
 * is no such stack, no such account, or nothing left in it: the row exists to get balances out,
 * not to advertise an empty account.
 */
/**
 * The venue's own asset and module for spot, for the ticket to sign against, so a cutover on the
 * backend cannot leave the ticket signing for a stack the venue no longer settles. Undefined when the
 * venue did not report them, and the configured defaults apply.
 */
function servedOrderMarket(spotMarket: SpotMarket): OrderMarketOverride | undefined {
  return spotMarket.orderStack === null
    ? undefined
    : { ...spotMarket.orderStack, orderIdPrefix: "spot" };
}

/** One cent in the ledger's 18-decimal USDC units. */
const LEGACY_DUST_USDC_UNITS = 10n ** 16n;
/** USDC per cNGN to value cNGN dust at when the market shows no price: 1,300 cNGN to the dollar. */
const LEGACY_DUST_FALLBACK_USDC_PER_CNGN = 1 / 1300;

/**
 * The cNGN worth one cent, in 18-decimal ledger units, at the market's price. What is left after a
 * withdrawal rounds to less than this and is not worth a row.
 */
function legacyDustCngnUnits(markUsdcPerCngn: number | null): bigint {
  const price =
    markUsdcPerCngn !== null && markUsdcPerCngn > 0
      ? markUsdcPerCngn
      : LEGACY_DUST_FALLBACK_USDC_PER_CNGN;
  // A cent's worth of cNGN to six decimals, then scaled to the ledger's eighteen.
  return BigInt(Math.round((0.01 / price) * 1e6)) * 10n ** 12n;
}

/**
 * The wallet's old spot account as withdraw-only rows, one per asset still worth showing. An asset
 * under one cent is left out: a fully withdrawn account leaves dust (interest, rounding) that would
 * otherwise keep a "withdraw only" row on screen forever for a balance nothing can usefully move.
 */
function buildLegacySpotView(
  stack: { usdcEscrow: `0x${string}`; cngnEscrow: `0x${string}` } | null,
  accountId: string | null,
  rows: { asset: string; balance: bigint }[] | null,
  markUsdcPerCngn: number | null
): {
  accountId: string;
  cngnLabel: string | null;
  usdcLabel: string | null;
  cngnUnits: bigint;
  usdcUnits: bigint;
} | null {
  if (stack === null || accountId === null || rows === null) {
    return null;
  }
  const held = (escrow: string) =>
    rows.find((row) => row.asset.toLowerCase() === escrow.toLowerCase())?.balance ?? 0n;
  const usdcUnits = held(stack.usdcEscrow);
  const cngnUnits = held(stack.cngnEscrow);
  const showUsdc = usdcUnits >= LEGACY_DUST_USDC_UNITS;
  const showCngn = cngnUnits >= legacyDustCngnUnits(markUsdcPerCngn);
  if (!(showUsdc || showCngn)) {
    return null;
  }
  return {
    accountId,
    cngnLabel: showCngn ? formatSubaccountCngnLabel(cngnUnits) : null,
    cngnUnits,
    usdcLabel: showUsdc ? formatSubaccountUsdcLabel(usdcUnits) : null,
    usdcUnits,
  };
}
