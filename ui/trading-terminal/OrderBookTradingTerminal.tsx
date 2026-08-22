"use client";

import { useLogin, usePrivy, useWallets } from "@privy-io/react-auth";
import { Duration } from "effect";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import { createWalletClient, custom } from "viem";
import { getAppChain } from "@/lib/base-public-client";
import type { OrderOutcome } from "@/lib/order-settlement";
import { pollOrderOutcome } from "@/lib/order-settlement";
import { getMarketableLimitPrice } from "@/lib/spot-market";
import {
  buildCancelEnvelope,
  buildSpotOrderEnvelope,
  SPOT_ORDER_LIFETIME_LABEL,
} from "@/lib/spot-order-submission";
import type { DepositCurrency } from "@/lib/subaccount-deposit.types";
import { getFirstDepositableCurrency } from "@/lib/subaccount-deposit-config";
import type { SpotMarket } from "@/lib/trading.types";
import { buildDepositAccount, DepositDialog } from "@/ui/trading-terminal/DepositDialog";
import { MarketDocumentTitle } from "@/ui/trading-terminal/MarketDocumentTitle";
import { SpotTradingTerminal } from "@/ui/trading-terminal/SpotTradingTerminal";
import { formatCngnBalanceLabel, useCngnBalance } from "@/ui/trading-terminal/useCngnBalance";
import {
  formatSubaccountCngnLabel,
  formatSubaccountUsdcLabel,
  toLedgerAmount,
  useSubaccountBalance,
} from "@/ui/trading-terminal/useSubaccountBalance";
import { useTradingSubaccount } from "@/ui/trading-terminal/useTradingSubaccount";
import { formatUsdcBalanceLabel, useUsdcBalance } from "@/ui/trading-terminal/useUsdcBalance";

type SpotExecutionPrice = { price: string } | { error: string };

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
  // turn the market order into a resting limit. The fill still happens at the maker's price.
  const marketable = getMarketableLimitPrice(side, book.bestAsk, book.bestBid);

  if (marketable === null) {
    return { error: "No opposing spot liquidity to cross. Use a limit order." };
  }

  return { price: String(marketable) };
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
  if (outcome?.status === "filled") {
    return `Filled ${size} USDC. Balances updated.`;
  }
  if (outcome?.status === "expired") {
    return `Order expired unfilled at ₦${price}.`;
  }
  if (outcome?.status === "cancelled") {
    return "Order cancelled.";
  }
  if (outcome?.status === "active") {
    const filled = Number(outcome.filled_amount ?? "0");
    return filled > 0
      ? `Partly filled, the rest resting at ₦${price}. Expires ${SPOT_ORDER_LIFETIME_LABEL} after signing.`
      : `Resting at ₦${price}. Expires ${SPOT_ORDER_LIFETIME_LABEL} after signing, or cancel it from Open Orders.`;
  }
  // No status yet: say what is certain rather than claiming a fill.
  return `Order accepted at ₦${price}. Check Open Orders for its status.`;
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
    size_usdc_notional: size,
  };
}

export function OrderBookTradingTerminal({ spotMarket }: { spotMarket: SpotMarket }) {
  // `null` until something actually happens — an idle placeholder would occupy
  // footer space in the order ticket without telling the trader anything.
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const router = useRouter();

  const { authenticated, ready: privyReady } = usePrivy();
  // No callbacks here: PrivyWalletButton owns the analytics side of login, and a second
  // useLogin with its own onComplete would double-count every connection.
  const { login } = useLogin();
  const { ready: walletsReady, wallets } = useWallets();
  // The header hosts the one deposit dialog; the order ticket opens it through this state.
  const [depositOpen, setDepositOpen] = useState(false);
  // Which asset it opens on. Held here rather than inside the dialog because the ticket names the
  // currency when it sends the trader over — a "Deposit cNGN" button must not land on the USDC form.
  const [depositCurrency, setDepositCurrency] = useState<DepositCurrency>(
    getFirstDepositableCurrency
  );
  const [resumeDepositAfterLogin, setResumeDepositAfterLogin] = useState(false);
  // Stays false while Privy is still restoring a session, so account-scoped panels never flash for visitors.
  const isSignedIn = privyReady && authenticated;
  /*
   * Deliberately gated on the session, not just `wallets[0]`.
   *
   * An extension can be connected to the page without Privy having issued a session — a wallet
   * login abandoned at the signature step, or a logout that left the extension connected. Taking
   * that wallet made the app contradict itself: the header offered "Connect Wallet" while the
   * account strip showed real balances, the deposit dialog offered to fund the wallet's existing
   * subaccount, and an order would have signed and submitted. `posthog.identify` never runs for
   * that user either, so their orders land on an anonymous distinct id.
   *
   * The cost is one extra click for a connect-only user; the alternative is a live Buy button in
   * front of someone who believes they are disconnected.
   */
  /**
   * Which connected wallet the terminal is acting as, chosen on the deposit dialog's Transfer from
   * screen. It moves the whole identity, not just who signs the transfer: a first deposit creates
   * the trading account and the account belongs to the signer, so a wallet that funds must also be
   * the wallet whose subaccount, orders and cancels this session uses. Unset until the trader picks
   * one, which leaves the first connected wallet in charge.
   */
  const [selectedWalletAddress, setSelectedWalletAddress] = useState<string | null>(null);
  const primaryWallet = isSignedIn
    ? (wallets.find((wallet) => wallet.address === selectedWalletAddress) ?? wallets[0] ?? null)
    : null;
  /*
   * The ticket gates on the wallet rather than the session because a session can exist before its
   * embedded wallet does: an email login is authenticated while Privy is still provisioning one.
   */
  const hasWallet = primaryWallet !== null;
  const {
    adoptSubaccountId,
    ensureTradingSubaccount,
    isLoading: isResolvingTradingSubaccount,
    subaccountId: tradingSubaccountId,
  } = useTradingSubaccount(primaryWallet?.address ?? null);
  const depositAccount = buildDepositAccount(primaryWallet, tradingSubaccountId);
  const isPreparingAccount = isPreparingTradingAccount({
    isResolvingSubaccount: isResolvingTradingSubaccount,
    isSignedIn,
    walletsReady,
  });
  const { balance: usdcBalance, refresh: refreshUsdcBalance } = useUsdcBalance(
    primaryWallet?.address ?? null
  );
  const { balance: cngnBalance, refresh: refreshCngnBalance } = useCngnBalance(
    primaryWallet?.address ?? null
  );
  const { balance: subaccountBalance, refresh: refreshSubaccountBalance } =
    useSubaccountBalance(tradingSubaccountId);
  const accountUsdcLabel = formatSubaccountUsdcLabel(subaccountBalance?.cashUnits ?? null);
  const accountCngnLabel = formatSubaccountCngnLabel(subaccountBalance?.cngnUnits ?? null);

  function handleDeposited(depositedSubaccountId: string) {
    adoptSubaccountId(depositedSubaccountId);
    refreshUsdcBalance();
    refreshCngnBalance();
    refreshSubaccountBalance();
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
      setLastAction("Wallet is still loading");
      return;
    }
    if (!primaryWallet?.address) {
      setLastAction("Connect a wallet before submitting an order");
      return;
    }
    const resolvedPrice = resolveSpotExecutionPrice(orderType, side, book, price);

    if ("error" in resolvedPrice) {
      setLastAction(resolvedPrice.error);
      return;
    }

    const executionPrice = resolvedPrice.price;

    try {
      setIsSubmittingOrder(true);
      setLastAction(
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
        side,
        subaccountId: resolvedTradingSubaccountId,
        uiPrice: executionPrice,
        uiSize: size,
        walletAddress: primaryWallet.address,
      });
      setLastAction(
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
        setLastAction(body?.error ?? "Spot order submission failed");
        return;
      }
      posthog.capture("order_submitted", {
        ...buildSpotOrderEvent(side, orderType, size, executionPrice),
        order_id: body?.order?.order_id ?? null,
      });
      setLastAction("Order accepted. Checking whether it filled…");
      // Poll until the venue has recorded the order, so the refresh below fetches a book that lists
      // it. A resting order reaches `active_orders` a few seconds after acceptance, and the book
      // reads that same store — refreshing before it lands left Open Orders empty until a later
      // render happened to catch up.
      const outcome = await pollOrderOutcome(() => readOrderOutcome(envelope.payload.order_id), {
        intervalMs: ORDER_SETTLE_POLL_INTERVAL_MS,
        timeoutMs: ORDER_SETTLE_TIMEOUT_MS,
      });
      setLastAction(describeOrderOutcome(outcome, size, executionPrice));
      // Read balances after the outcome, not before it: refreshing on acceptance alone showed the
      // pre-fill account and left the strip disagreeing with the trade that had just happened.
      refreshUsdcBalance();
      refreshCngnBalance();
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
      setLastAction(errorMessage);
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

  return (
    <main className="flex min-h-screen flex-col bg-terminal-bg text-foreground transition-colors duration-300 xl:h-dvh xl:overflow-hidden">
      <MarketDocumentTitle pair="USDC/cNGN" price={spotMarket.mark} />

      <SpotTradingTerminal
        accountCngn={toLedgerAmount(subaccountBalance?.cngnUnits ?? null)}
        accountCngnLabel={accountCngnLabel}
        accountUsdc={toLedgerAmount(subaccountBalance?.cashUnits ?? null)}
        accountUsdcLabel={accountUsdcLabel}
        candles={spotMarket.candles}
        cngnBalanceLabel={formatCngnBalanceLabel(cngnBalance)}
        depositControl={
          <DepositDialog
            account={depositAccount}
            accountRows={subaccountBalance?.rows ?? null}
            currency={depositCurrency}
            fundingWallets={isSignedIn ? wallets : []}
            onConnectWallet={handleConnectWallet}
            onCurrencyChange={setDepositCurrency}
            onDeposited={handleDeposited}
            onOpenChange={setDepositOpen}
            onSelectFundingWallet={(wallet) => setSelectedWalletAddress(wallet.address)}
            onWithdrawn={() => {
              refreshSubaccountBalance();
              refreshUsdcBalance();
              refreshCngnBalance();
            }}
            open={depositOpen}
            triggerClassName="flex h-10 cursor-pointer items-center whitespace-nowrap rounded-full bg-input-bg px-4 font-semibold text-[12px] text-panel-text ring-1 ring-panel-border transition-colors hover:bg-input-hover hover:text-panel-text-active disabled:cursor-not-allowed disabled:opacity-60"
            triggerId="header-deposit-trigger"
            walletBalances={{ cNGN: cngnBalance, USDC: usdcBalance }}
          />
        }
        hasWallet={hasWallet}
        isPreparingAccount={isPreparingAccount}
        isSignedIn={isSignedIn}
        isSubmitting={isSubmittingOrder}
        lastAction={lastAction}
        onCancelOrder={handleCancelSpot}
        onDepositRequest={(currency) => {
          if (currency !== undefined) {
            setDepositCurrency(currency);
          }
          setDepositOpen(true);
        }}
        onSubmitOrder={handleSubmitSpot}
        spotMarket={spotMarket}
        usdcBalanceLabel={formatUsdcBalanceLabel(usdcBalance)}
        walletAddress={primaryWallet?.address ?? null}
      />
    </main>
  );
}
