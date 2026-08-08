"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { useEffect, useRef, useState } from "react";
import { createWalletClient, custom } from "viem";
import { getAppChain } from "@/lib/base-public-client";
import {
  buildFutureOrderEnvelope,
  canSubmitFutureOrder,
  TAKER_FEE_RATE,
} from "@/lib/future-order-submission";
import { formatFxDisplayPair, getInstrumentDisplayLabel } from "@/lib/market-display";
import { calculateAnnualizedBasisPercent, formatSignedContracts } from "@/lib/market-formatting";
import {
  buildMarketSelectionAliasMap,
  buildMarketUrlSlug,
  isSpotMarketSelection,
  resolveHydratedMarketSelection,
  resolveMarketSelection,
  SPOT_URL_SLUG,
} from "@/lib/market-selection";
import { DEFAULT_ORDER_TYPE } from "@/lib/mock-orderbook-terminal-data";
import { buildSpotOrderEnvelope } from "@/lib/spot-order-submission";
import type { ContractMarket, DeliveryTerm, MarketDefinition, MarketId } from "@/lib/trading.types";
import { AppSectionSwitcher, AppSidebar } from "@/ui/AppSidebar";
import type { AppSection } from "@/ui/app-sidebar.types";
import { DepositDialog } from "@/ui/trading-terminal/DepositDialog";
import { FuturesTradingTerminal } from "@/ui/trading-terminal/FuturesTradingTerminal";
import { MarketDocumentTitle } from "@/ui/trading-terminal/MarketDocumentTitle";
import { SpotTradingTerminal } from "@/ui/trading-terminal/SpotTradingTerminal";
import { TradingMarketHeader } from "@/ui/trading-terminal/TradingMarketHeader";
import { useAccountMaintenanceMargin } from "@/ui/trading-terminal/useAccountMaintenanceMargin";
import { formatCngnBalanceLabel, useCngnBalance } from "@/ui/trading-terminal/useCngnBalance";
import { useFuturesPosition } from "@/ui/trading-terminal/useFuturesPosition";
import { useInitialMarginRate } from "@/ui/trading-terminal/useInitialMarginRate";
import {
  formatSubaccountCngnLabel,
  formatSubaccountUsdcLabel,
  useSubaccountBalance,
} from "@/ui/trading-terminal/useSubaccountBalance";
import { useTradingSubaccount } from "@/ui/trading-terminal/useTradingSubaccount";
import { formatUsdcBalanceLabel, useUsdcBalance } from "@/ui/trading-terminal/useUsdcBalance";

const SELECTED_MARKET_STORAGE_KEY = "trading-terminal-selected-market";
function parseNumericString(value: string) {
  const parsed = Number(value.replaceAll(",", "").replaceAll("$", "").replaceAll("+", ""));

  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatSignedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  let sign = "";
  if (value > 0) {
    sign = "+";
  } else if (value < 0) {
    sign = "-";
  }

  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function getRenderablePriceInput(mark: string) {
  const parsedMark = parseNumericString(mark);
  return Number.isFinite(parsedMark) ? mark.replaceAll(",", "") : "";
}

function _getDirectionalLabel(orderSide: "buy" | "sell", marketDefinition: MarketDefinition) {
  if (
    marketDefinition.type === "future" &&
    formatFxDisplayPair(marketDefinition.pair) === "USDC/cNGN"
  ) {
    return orderSide === "buy" ? "Long" : "Short";
  }

  const [base] = formatFxDisplayPair(marketDefinition.pair).split("/");

  if (!base) {
    return orderSide === "buy" ? "Long" : "Short";
  }

  return orderSide === "buy" ? `Long ${base}` : `Short ${base}`;
}

function getFutureMarketCrossingPrice(
  orderSide: "buy" | "sell",
  orderType: "Limit" | "Market" | "Stop",
  market: ContractMarket
) {
  if (orderType !== "Market") {
    return null;
  }

  const bestOpposingLevel = orderSide === "buy" ? market.orderBookAsks[0] : market.orderBookBids[0];

  if (!bestOpposingLevel) {
    return null;
  }

  return bestOpposingLevel.price.toString();
}

type SpotExecutionPrice = { price: string } | { error: string };

/**
 * Market spot orders cross the opposing side of the book; every other order type executes at the
 * entered price. Returns the operator-facing copy rather than throwing, so a missing book side
 * reads the same as it did inline.
 */
function resolveSpotExecutionPrice(
  orderType: "Limit" | "Market" | "Stop Limit",
  side: "buy" | "sell",
  spotMarket: ContractMarket,
  enteredPrice: string
): SpotExecutionPrice {
  if (orderType !== "Market") {
    return { price: enteredPrice };
  }

  const opposing = side === "buy" ? spotMarket.orderBookAsks[0] : spotMarket.orderBookBids[0];

  if (!opposing) {
    return { error: "No opposing spot liquidity to cross. Use a limit order." };
  }

  return { price: String(opposing.price) };
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

/** Properties shared by every spot order analytics event. */
function buildSpotOrderEvent(
  side: "buy" | "sell",
  orderType: "Limit" | "Market" | "Stop Limit",
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

/**
 * The three numbers the ticket footer keeps permanently in view: what the order costs to open,
 * what it costs to fill, and how much margin the account has left.
 *
 * There is deliberately no liquidation price. Liquidation is portfolio-level in this risk model —
 * `DutchAuction` starts an auction on the subaccount's maintenance margin going negative, and cNGN
 * collateral is valued at the same FX rate that drives the position's P&L — so no single price
 * liquidates an order in isolation. `Account Margin` is the quantity that actually decides it.
 */
function getOrderSummaryRows({
  accountMargin,
  fees,
  futuresPosition,
  initialMargin,
}: {
  accountMargin: number | null;
  fees: number;
  futuresPosition: number | null;
  initialMargin: number | null;
}) {
  return [
    {
      label: "Margin Required",
      // No quote rather than a guess: the requirement is the venue's, and an invented one misleads
      // a trader sizing a position far more than a dash does.
      value:
        initialMargin === null
          ? "—"
          : `${initialMargin.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} USDC`,
    },
    {
      label: "Fees",
      value: `${fees.toLocaleString("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 2 })} USDC`,
    },
    {
      label: "Position",
      // Read from the ledger. Signed: positive is long, negative is short, and exactly zero is
      // flat rather than "no data" — which is why null and 0 render differently.
      value: futuresPosition === null ? "—" : formatSignedContracts(futuresPosition),
    },
    {
      label: "Account Margin",
      value:
        accountMargin === null
          ? "—"
          : `${accountMargin.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} USDC`,
    },
  ] satisfies DeliveryTerm[];
}

function getOrderMetrics(size: string, initialMarginRate: number | null) {
  const sizeNumber = Number(size || "0");

  // Margin is posted as USDC collateral and the taker fee is charged on the USDC notional, so both
  // are sized off `sizeNumber` (USDC) rather than the quote-currency order value. The fee quote
  // reuses the same tier that bounds `worstFee` on submission so the ticket cannot under-quote
  // what the trader signs for. The margin rate is the venue's own, read from the risk-core manager.
  return {
    fees: sizeNumber * Number(TAKER_FEE_RATE),
    initialMargin: initialMarginRate === null ? null : sizeNumber * initialMarginRate,
  };
}

export function OrderBookTradingTerminal({
  defaultMarketId,
  initialMarketId,
  marketData,
  marketDefinitions,
}: {
  defaultMarketId: MarketId;
  initialMarketId: MarketId;
  marketData: Record<MarketId, ContractMarket>;
  marketDefinitions: MarketDefinition[];
  /** External NGN/USD reference price used only to sanity-check the live spot
   * mark. Never charted — the chart shows this venue's own fills. */
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedMarketParam = searchParams.get("market");
  const [selectedMarketId, setSelectedMarketId] = useState<MarketId>(initialMarketId);
  const [orderType, setOrderType] = useState<"Limit" | "Market" | "Stop">(DEFAULT_ORDER_TYPE);
  const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
  const [size, setSize] = useState("1");
  // Seeded from the market actually being rendered, not a literal. Both `setLimitPrice` resets
  // below fire only when the selected market *changes*, so on a direct load — where
  // `selectedMarketId` already equals `initialMarketId` — neither runs and whatever this initialises
  // to is what the trader sees in the price box.
  const [limitPrice, setLimitPrice] = useState(() =>
    getRenderablePriceInput(marketData[initialMarketId]?.mark ?? "")
  );
  const [activeSection, setActiveSection] = useState<AppSection>("spot");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // `null` until something actually happens — an idle placeholder would occupy
  // footer space in the order ticket without telling the trader anything.
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [hasHydratedSelection, setHasHydratedSelection] = useState(false);
  const selectedMarketIdRef = useRef(initialMarketId);

  const selectedMarket =
    marketDefinitions.find((marketOption) => marketOption.id === selectedMarketId) ??
    marketDefinitions[0];

  const selectMarketForSection = (targetMarket: MarketDefinition) => {
    if (targetMarket.id === selectedMarketId) {
      return;
    }

    posthog.capture("market_selected", {
      market_id: targetMarket.id,
      market_label: getInstrumentDisplayLabel(targetMarket),
      market_pair: targetMarket.pair,
      market_type: targetMarket.type,
    });

    setSelectedMarketId(targetMarket.id);
    setLimitPrice(getRenderablePriceInput(marketData[targetMarket.id].mark));
  };

  const handleSectionChange = (section: AppSection) => {
    setActiveSection(section);

    if (section !== "spot" && section !== "derivatives") {
      return;
    }

    const targetMarket =
      section === "spot"
        ? marketDefinitions.find((marketOption) => marketOption.type === "spot")
        : (marketDefinitions.find(
            (marketOption) => marketOption.id === defaultMarketId && marketOption.type === "future"
          ) ?? marketDefinitions.find((marketOption) => marketOption.type === "future"));

    if (targetMarket) {
      selectMarketForSection(targetMarket);
    }
  };

  const handleOpenMarketFromSection = (marketId: MarketId) => {
    const targetMarket = marketDefinitions.find((marketOption) => marketOption.id === marketId);

    if (!targetMarket) {
      return;
    }

    setActiveSection(targetMarket.type === "spot" ? "spot" : "derivatives");
    selectMarketForSection(targetMarket);
  };

  const { authenticated, ready: privyReady } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const primaryWallet = wallets[0] ?? null;
  // Stays false while Privy is still restoring a session, so account-scoped panels never flash for visitors.
  const isSignedIn = privyReady && authenticated;
  const {
    adoptSubaccountId,
    ensureTradingSubaccount,
    isLoading: isResolvingTradingSubaccount,
    subaccountId: tradingSubaccountId,
  } = useTradingSubaccount(primaryWallet?.address ?? null);
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

  const market = marketData[selectedMarketId];
  const referenceSpotPrice = parseNumericString(marketData["cngn-usdc-spot"].mark);
  const livePrice = parseNumericString(market.mark);
  const safeLivePrice = Number.isFinite(livePrice) ? livePrice : null;
  // Basis is futures against this venue's own spot mark — the basis actually capturable here.
  // Pinned to that one denominator: it previously divided by whatever getCompatibleSpotPrice
  // returned, which swapped in the external NGN/USD rate and silently changed what the number
  // meant once the two diverged by 8%.
  const futuresMarkPrice = parseNumericString(market.mark);
  const basisPercent =
    selectedMarket.type === "future" && Number.isFinite(referenceSpotPrice)
      ? calculateAnnualizedBasisPercent(
          futuresMarkPrice,
          referenceSpotPrice,
          selectedMarket.expiryDays
        )
      : null;

  // The futures ticket is denominated in contracts (matching the order book). Order economics and
  // on-chain submission work in USDC notional: 1 contract = contractMultiplier USDC.
  const futureContractMultiplier =
    Number((selectedMarket.contractMultiplier ?? "10000").replaceAll(",", "")) || 10_000;
  const sizeUsdcNotional = String((Number(size) || 0) * futureContractMultiplier);

  const initialMarginRate = useInitialMarginRate({
    assetAddress: selectedMarket.assetAddress,
    subId: selectedMarket.subId,
  });
  const accountMargin = useAccountMaintenanceMargin(tradingSubaccountId);
  const futuresPosition = useFuturesPosition({
    assetAddress: selectedMarket.assetAddress,
    subaccountId: tradingSubaccountId,
    subId: selectedMarket.subId,
  });
  const { fees, initialMargin } = getOrderMetrics(sizeUsdcNotional, initialMarginRate);

  const orderSummaryRows = getOrderSummaryRows({
    accountMargin,
    fees,
    futuresPosition,
    initialMargin,
  });

  useEffect(() => {
    selectedMarketIdRef.current = selectedMarketId;
  }, [selectedMarketId]);

  useEffect(() => {
    function markSelectionHydrated() {
      if (!hasHydratedSelection) {
        setHasHydratedSelection(true);
      }
    }

    const storedMarket = window.localStorage.getItem(SELECTED_MARKET_STORAGE_KEY);
    const selectionToken =
      requestedMarketParam && requestedMarketParam.trim() !== ""
        ? requestedMarketParam
        : storedMarket;

    // Spot is a view mode, not a row in marketDefinitions, so resolve it up front.
    if (isSpotMarketSelection(selectionToken)) {
      setActiveSection("spot");
      markSelectionHydrated();
      return;
    }

    const marketSelectionAliases = buildMarketSelectionAliasMap(marketDefinitions);
    const resolution = resolveHydratedMarketSelection({
      aliases: marketSelectionAliases,
      defaultMarketId,
      requestedMarket: requestedMarketParam,
      storedMarket,
    });

    if (resolution.shouldIgnoreInvalidRequestedMarket) {
      markSelectionHydrated();
      return;
    }

    if (!resolution.selectedMarketId) {
      markSelectionHydrated();
      return;
    }

    const nextMarket = marketDefinitions.find(
      (marketOption) => marketOption.id === resolution.selectedMarketId
    );
    if (!nextMarket) {
      markSelectionHydrated();
      return;
    }

    // Only an explicit non-spot selection switches into the futures view; a bare
    // visit with no token keeps the default spot section.
    const hasExplicitSelection = Boolean(selectionToken && selectionToken.trim() !== "");
    if (hasExplicitSelection && nextMarket.type !== "spot") {
      setActiveSection("derivatives");
    }

    if (resolution.selectedMarketId !== selectedMarketIdRef.current) {
      setSelectedMarketId(resolution.selectedMarketId);
      setLimitPrice(getRenderablePriceInput(marketData[resolution.selectedMarketId].mark));
    }

    markSelectionHydrated();
  }, [defaultMarketId, hasHydratedSelection, marketData, marketDefinitions, requestedMarketParam]);

  useEffect(() => {
    if (!hasHydratedSelection) {
      return;
    }

    const marketSelectionAliases = buildMarketSelectionAliasMap(marketDefinitions);
    const canonicalMarketId =
      resolveMarketSelection(selectedMarketId, marketSelectionAliases) ?? selectedMarketId;
    const selectedMarketDefinition = marketDefinitions.find(
      (option) => option.id === canonicalMarketId
    );
    // Spot is a view mode with no marketDefinitions row, so its URL is the bare
    // pair slug; the futures view uses the selected contract's symbol.
    const viewUrlSlug =
      activeSection === "spot"
        ? SPOT_URL_SLUG
        : buildMarketUrlSlug(selectedMarketDefinition) || canonicalMarketId;
    const currentSearchParams = new URLSearchParams(window.location.search);
    const requestedMarket = currentSearchParams.get("market");
    const isResolvableRequest =
      isSpotMarketSelection(requestedMarket) ||
      Boolean(
        requestedMarket &&
          requestedMarket.trim() !== "" &&
          resolveMarketSelection(requestedMarket, marketSelectionAliases)
      );

    if (requestedMarket && requestedMarket.trim() !== "" && !isResolvableRequest) {
      return;
    }

    window.localStorage.setItem(SELECTED_MARKET_STORAGE_KEY, viewUrlSlug);

    // Already showing the preferred slug — nothing to do. Any other form (a raw
    // `address:subId`, a legacy alias, or a dated futures symbol while on spot)
    // gets canonicalized so the URL always matches the visible view.
    if (requestedMarket === viewUrlSlug) {
      return;
    }

    currentSearchParams.set("market", viewUrlSlug);
    window.history.replaceState(null, "", `${pathname}?${currentSearchParams.toString()}`);
  }, [activeSection, hasHydratedSelection, marketDefinitions, pathname, selectedMarketId]);

  // Candles come from the venue's own fills via markets-service; there is no
  // client-side ticking. A random walk here would overwrite real price history
  // with invented movement.

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Order submission needs wallet, env, signing, and backend submission checks in one submit path.
  async function handleSubmit(orderSide: "buy" | "sell") {
    setOrderSide(orderSide);

    if (!walletsReady) {
      setLastAction("Wallet is still loading");
      return;
    }

    if (!primaryWallet?.address) {
      setLastAction("Connect a wallet before submitting an order");
      return;
    }

    if (!canSubmitFutureOrder(selectedMarket)) {
      setLastAction(
        "Live futures execution is unavailable because markets-service did not expose the future asset"
      );
      return;
    }

    const derivedCrossingPrice = getFutureMarketCrossingPrice(orderSide, orderType, market);
    const executionLimitPrice = derivedCrossingPrice ?? limitPrice;

    if (orderType === "Market" && !derivedCrossingPrice) {
      setLastAction(
        "No opposing futures liquidity is available. Market orders need a live bid/ask to cross."
      );
      return;
    }

    try {
      setIsSubmittingOrder(true);
      setLastAction(
        tradingSubaccountId
          ? `Submitting futures order on trading account #${tradingSubaccountId}`
          : "Preparing trading account..."
      );

      const resolvedTradingSubaccountId =
        tradingSubaccountId ?? (await ensureTradingSubaccount(primaryWallet));

      const appChain = getAppChain();
      await primaryWallet.switchChain(appChain.id);

      const provider = await primaryWallet.getEthereumProvider();
      const walletClient = createWalletClient({
        chain: appChain,
        transport: custom(provider),
      });
      const envelope = buildFutureOrderEnvelope({
        limitPrice: executionLimitPrice,
        market: selectedMarket,
        side: orderSide,
        size: sizeUsdcNotional,
        subaccountId: resolvedTradingSubaccountId,
        walletAddress: primaryWallet.address,
      });
      setLastAction(
        `Awaiting wallet signature for trading account #${resolvedTradingSubaccountId}`
      );
      const signature = await walletClient.signTypedData({
        account: primaryWallet.address as `0x${string}`,
        ...envelope.typedData,
      });
      const response = await fetch("/api/orders", {
        body: JSON.stringify({
          ...envelope.payload,
          signature,
        }),
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        order?: {
          order_id?: string;
        };
      } | null;

      if (!response.ok) {
        posthog.capture("order_rejected", {
          error_message: payload?.error ?? null,
          http_status: response.status,
          limit_price: executionLimitPrice,
          market_id: selectedMarketId,
          market_pair: selectedMarket.pair,
          order_side: orderSide,
          order_type: orderType,
          size_contracts: size,
          size_usdc_notional: sizeUsdcNotional,
        });
        setLastAction(payload?.error ?? "Futures order submission failed");
        return;
      }

      posthog.capture("order_submitted", {
        limit_price: executionLimitPrice,
        market_id: selectedMarketId,
        market_pair: selectedMarket.pair,
        order_id: payload?.order?.order_id ?? null,
        order_side: orderSide,
        order_type: orderType,
        position_before_contracts: futuresPosition,
        size_contracts: size,
        size_usdc_notional: sizeUsdcNotional,
      });
      // No claim about the resulting position: an order can rest unfilled, fill partially, or
      // reduce an existing position, and settlement lands asynchronously. The Position row reads
      // the ledger, which is the only thing that actually knows.
      setLastAction(
        `Futures order accepted: ${orderSide.toUpperCase()} ${size} contracts (${sizeUsdcNotional} USDC notional) @ ${executionLimitPrice} cNGN/USDC on ${market.ticker}`
      );
      return;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Futures order submission failed";
      posthog.captureException(error, {
        properties: {
          limit_price: executionLimitPrice,
          market_id: selectedMarketId,
          order_side: orderSide,
          order_type: orderType,
          size_contracts: size,
        },
      });
      posthog.capture("order_failed", {
        error_message: errorMessage,
        limit_price: executionLimitPrice,
        market_id: selectedMarketId,
        market_pair: selectedMarket.pair,
        order_side: orderSide,
        order_type: orderType,
        size_contracts: size,
        size_usdc_notional: sizeUsdcNotional,
      });
      setLastAction(errorMessage);
      return;
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  async function handleSubmitSpot({
    side,
    price,
    size,
    orderType,
  }: {
    side: "buy" | "sell";
    price: string;
    size: string;
    orderType: "Limit" | "Market" | "Stop Limit";
  }) {
    if (!walletsReady) {
      setLastAction("Wallet is still loading");
      return;
    }
    if (!primaryWallet?.address) {
      setLastAction("Connect a wallet before submitting an order");
      return;
    }
    const resolvedPrice = resolveSpotExecutionPrice(
      orderType,
      side,
      marketData["cngn-usdc-spot"],
      price
    );

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
      setLastAction(
        `Spot order accepted: ${side.toUpperCase()} ${size} USDC @ ${executionPrice} cNGN/USDC`
      );
      refreshUsdcBalance();
      refreshCngnBalance();
      refreshSubaccountBalance();
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

  // The tab title shows this venue's spot price, not the external NGN/USD rate — the ticker
  // beside it is venue-sourced, and the two disagreeing was the last place that leaked through.
  const safeVenueSpotPrice = Number.isFinite(referenceSpotPrice) ? referenceSpotPrice : null;
  // The spot chart shows this venue's own fills. It previously charted an external
  // NGN/USD reference series whenever that series happened to sit within 8% of the
  // live price — agreeing with the price does not make it this exchange's trades.
  const spotCandles = marketData["cngn-usdc-spot"].candles;

  return (
    <main className="flex min-h-screen bg-terminal-bg text-foreground transition-colors duration-300 xl:h-dvh xl:overflow-hidden">
      <MarketDocumentTitle
        pair={activeSection === "spot" ? "USDC/cNGN" : formatFxDisplayPair(selectedMarket.pair)}
        price={activeSection === "spot" ? safeVenueSpotPrice : safeLivePrice}
      />

      <AppSidebar
        activeSection={activeSection}
        collapsed={sidebarCollapsed}
        onCollapsedToggle={() => setSidebarCollapsed((current) => !current)}
        onSectionChange={handleSectionChange}
      />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col gap-3 p-3 xl:h-dvh xl:overflow-hidden xl:px-4">
        <TradingMarketHeader
          depositControl={
            <DepositDialog
              onDeposited={handleDeposited}
              subaccountId={tradingSubaccountId}
              triggerClassName="flex h-8 cursor-pointer items-center whitespace-nowrap rounded-lg bg-input-bg px-2.5 font-semibold text-[11px] text-panel-text ring-1 ring-panel-border transition-colors hover:bg-input-hover hover:text-panel-text-active disabled:cursor-not-allowed disabled:opacity-60"
              triggerId="header-deposit-trigger"
              wallet={primaryWallet}
            />
          }
          sectionControl={
            <AppSectionSwitcher
              activeSection={activeSection}
              onSectionChange={handleSectionChange}
            />
          }
        />

        {activeSection === "spot" ? (
          <SpotTradingTerminal
            accountCngnLabel={accountCngnLabel}
            accountUsdcLabel={accountUsdcLabel}
            candles={spotCandles}
            cngnBalanceLabel={formatCngnBalanceLabel(cngnBalance)}
            isPreparingAccount={isResolvingTradingSubaccount}
            isSignedIn={isSignedIn}
            isSubmitting={isSubmittingOrder}
            lastAction={lastAction}
            onSubmitOrder={handleSubmitSpot}
            spotMarket={marketData["cngn-usdc-spot"]}
            usdcBalanceLabel={formatUsdcBalanceLabel(usdcBalance)}
          />
        ) : null}

        {activeSection === "derivatives" ? (
          <FuturesTradingTerminal
            accountCngnLabel={accountCngnLabel}
            accountUsdcLabel={accountUsdcLabel}
            basisLabel={formatSignedPercent(basisPercent)}
            candles={market.candles}
            isPreparingAccount={isResolvingTradingSubaccount}
            isSignedIn={isSignedIn}
            isSubmitting={isSubmittingOrder}
            lastAction={lastAction}
            lastPrice={safeLivePrice}
            limitPrice={limitPrice}
            market={market}
            marketDefinition={selectedMarket}
            marketDefinitions={marketDefinitions}
            onLimitPriceChange={setLimitPrice}
            onOrderTypeChange={setOrderType}
            onSelectMarket={handleOpenMarketFromSection}
            onSideChange={setOrderSide}
            onSizeChange={setSize}
            onSubmit={handleSubmit}
            orderSide={orderSide}
            orderSummaryRows={orderSummaryRows}
            orderType={orderType}
            size={size}
            usdcBalanceLabel={formatUsdcBalanceLabel(usdcBalance)}
          />
        ) : null}
      </div>
    </main>
  );
}
