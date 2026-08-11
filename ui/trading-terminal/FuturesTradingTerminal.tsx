"use client";

import { Popover } from "@base-ui/react/popover";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { getInstrumentDisplayLabel, getInstrumentSubtext } from "@/lib/market-display";
import { formatNaira } from "@/lib/market-formatting";
import {
  ACTIVITY_VIEWS,
  BOTTOM_TABS,
  FOOTER_LINKS,
  SPOT_TIMEFRAME_OPTIONS,
} from "@/lib/mock-orderbook-terminal-data";
import { get24hStats } from "@/lib/ticker-stats";
import type {
  Candle,
  ContractMarket,
  DeliveryTerm,
  MarketDefinition,
  MarketId,
} from "@/lib/trading.types";
import { SmartImage } from "@/ui/SmartImage";
import { FuturesOrderFormPanel } from "@/ui/trading-terminal/FuturesOrderFormPanel";
import { SpotBalanceSummary } from "@/ui/trading-terminal/SpotBalanceSummary";
import type { SpotChartTab, SpotTimeframe } from "@/ui/trading-terminal/SpotChartPanel";
import { SpotChartPanel } from "@/ui/trading-terminal/SpotChartPanel";
import type { SpotBookTab } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { SpotOrderBookPanel } from "@/ui/trading-terminal/SpotOrderBookPanel";
import { TradingActivityPanel } from "@/ui/trading-terminal/TradingActivityPanel";
import { useMarketOrderBook } from "@/ui/trading-terminal/useMarketOrderBook";

function formatChangePercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatContractSize(contractMultiplier: string | null | undefined) {
  const parsed = Number((contractMultiplier ?? "").replaceAll(",", ""));

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "—";
  }

  return `${parsed.toLocaleString("en-US")} USDC`;
}

function TickerStat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-1">
      <span className="whitespace-nowrap text-[10px] text-panel-text-muted">{label}</span>
      <span
        className={cn("whitespace-nowrap font-medium text-[13px] text-panel-text", valueClassName)}
      >
        {value}
      </span>
    </div>
  );
}

function FuturesTickerBar({
  basisLabel,
  changePercent24h,
  contractSizeLabel,
  expiryLabel,
  lastPrice,
  marketDefinition,
  marketDefinitions,
  onSelectMarket,
  volume24hLabel,
}: {
  basisLabel: string;
  changePercent24h: number | null;
  contractSizeLabel: string;
  expiryLabel: string;
  lastPrice: number | null;
  marketDefinition: MarketDefinition;
  marketDefinitions: MarketDefinition[];
  onSelectMarket: (marketId: MarketId) => void;
  volume24hLabel: string;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const isNegativeChange = changePercent24h !== null && changePercent24h < 0;
  const selectableFutures = marketDefinitions
    .filter((candidate) => candidate.pair === "USDCcNGN" && candidate.type === "future")
    .sort((first, second) => first.sortOrder - second.sortOrder);

  return (
    <section className="rounded-[20px] bg-panel-bg px-4 py-2.5 shadow-[0_24px_80px_var(--panel-shadow)] ring-1 ring-panel-ring transition-colors duration-300">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Popover.Root onOpenChange={setDropdownOpen} open={dropdownOpen}>
          <Popover.Trigger
            className="-m-1.5 flex cursor-pointer items-center gap-2.5 rounded-[14px] p-1.5 outline-none transition-colors hover:bg-input-hover focus-visible:ring-2 focus-visible:ring-panel-text-active/50"
            id="futures-ticker-contract-trigger"
          >
            <span className="flex shrink-0 items-center -space-x-1.5">
              <SmartImage<string>
                alt="USDC"
                className="size-6 animate-none rounded-full bg-input-bg p-0.5 ring-2 ring-panel-bg"
                src="/tokens/usdc.svg"
              />
              <SmartImage<string>
                alt="cNGN"
                className="size-6 animate-none rounded-full bg-input-bg p-0.5 ring-2 ring-panel-bg"
                src="/tokens/cngn.svg"
              />
            </span>
            <div className="flex flex-col text-left">
              <span className="flex items-center gap-1 font-semibold text-[16px] text-panel-text-active leading-none tracking-[-0.01em]">
                {getInstrumentDisplayLabel(marketDefinition)}
                <ChevronDown
                  className={cn(
                    "size-4 text-panel-text-muted transition-transform duration-200",
                    dropdownOpen && "rotate-180"
                  )}
                />
              </span>
            </div>
          </Popover.Trigger>

          <Popover.Portal>
            <Popover.Positioner align="start" sideOffset={8}>
              <Popover.Popup className="z-50 min-w-[280px] overflow-hidden rounded-2xl border border-panel-border bg-panel-bg-darker p-1.5 shadow-[0_20px_60px_var(--panel-shadow)] outline-none transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
                {selectableFutures.map((candidate) => (
                  <button
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 rounded-xl p-2.5 text-left transition-colors",
                      candidate.id === marketDefinition.id
                        ? "bg-input-bg text-panel-text-active"
                        : "text-panel-text hover:bg-input-hover"
                    )}
                    key={candidate.id}
                    onClick={() => {
                      onSelectMarket(candidate.id);
                      setDropdownOpen(false);
                    }}
                    type="button"
                  >
                    <span className="flex shrink-0 items-center -space-x-1">
                      <SmartImage<string>
                        alt="USDC"
                        className="size-5 rounded-full bg-input-bg p-0.5 ring-1 ring-panel-border"
                        src="/tokens/usdc.svg"
                      />
                      <SmartImage<string>
                        alt="cNGN"
                        className="size-5 rounded-full bg-input-bg p-0.5 ring-1 ring-panel-border"
                        src="/tokens/cngn.svg"
                      />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-semibold text-[13px] leading-none">
                        {getInstrumentDisplayLabel(candidate)}
                      </span>
                      <span className="text-[10px] text-panel-text-muted">
                        {getInstrumentSubtext(candidate)}
                      </span>
                    </span>
                  </button>
                ))}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>

        {/*
         * Futures carries more stats than fit a phone row, and they are contract terms rather
         * than duplicated market data, so none can be dropped. Below `sm` they stay on one
         * swipeable row: wrapping them instead costs ~140px of height above the order ticket.
         */}
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-x-5 overflow-x-auto sm:flex-wrap sm:gap-y-2 sm:overflow-x-visible">
          <div className="flex min-w-0 shrink-0 flex-col gap-1">
            <span className="whitespace-nowrap text-[10px] text-panel-text-muted">Price</span>
            <span className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="font-semibold text-[15px] text-panel-text-active leading-none">
                {formatNaira(lastPrice)}
              </span>
              <span
                className={cn(
                  "font-medium text-[11px] leading-none",
                  isNegativeChange ? "text-ask-text" : "text-bid-text"
                )}
              >
                {formatChangePercent(changePercent24h)}
              </span>
            </span>
          </div>

          {/*
           * Only 24H volume is dropped on phones — the chart panel repeats it directly below.
           * Basis, expiry and contract size stay: they are contract terms rather than market
           * stats, and the ticker is the only place contract size is shown.
           */}
          <div className="hidden items-center gap-x-5 sm:flex">
            <div className="h-8 w-px bg-panel-border" />
            <TickerStat label="24H volume" value={volume24hLabel} />
          </div>
          <div className="hidden h-8 w-px bg-panel-border sm:block" />
          <TickerStat label="Basis" value={basisLabel} />
          <div className="hidden h-8 w-px bg-panel-border sm:block" />
          <TickerStat label="Expiry" value={expiryLabel} />
          <div className="hidden h-8 w-px bg-panel-border sm:block" />
          <TickerStat label="Contract size" value={contractSizeLabel} />
        </div>
      </div>
    </section>
  );
}

export function FuturesTradingTerminal({
  basisLabel,
  candles,
  isSignedIn = false,
  isPreparingAccount = false,
  isSubmitting,
  lastAction,
  lastPrice,
  limitPrice,
  market,
  marketDefinition,
  marketDefinitions,
  onDepositRequest,
  onLimitPriceChange,
  onOrderTypeChange,
  onSelectMarket,
  onSideChange,
  onSizeChange,
  onSubmit,
  orderSide,
  orderSummaryRows,
  orderType,
  size,
  usdcBalanceLabel,
  accountUsdcLabel = null,
  accountCngnLabel = null,
}: {
  basisLabel: string;
  candles: Candle[];
  /** Whether a wallet session is active; gates account-scoped rows in the activity panel. */
  isSignedIn?: boolean;
  /** The trading subaccount is still being resolved — distinct from an order in flight. */
  isPreparingAccount?: boolean;
  isSubmitting: boolean;
  lastAction: string | null;
  lastPrice: number | null;
  limitPrice: string;
  market: ContractMarket;
  marketDefinition: MarketDefinition;
  marketDefinitions: MarketDefinition[];
  /** Opens the deposit dialog; the ticket CTA calls it while there is no funded account. */
  onDepositRequest?: () => void;
  onLimitPriceChange: (value: string) => void;
  onOrderTypeChange: (orderType: "Limit" | "Market" | "Stop") => void;
  onSelectMarket: (marketId: MarketId) => void;
  onSideChange: (side: "buy" | "sell") => void;
  onSizeChange: (value: string) => void;
  onSubmit: (side: "buy" | "sell") => void;
  orderSide: "buy" | "sell";
  orderSummaryRows: DeliveryTerm[];
  orderType: "Limit" | "Market" | "Stop";
  size: string;
  /** Wallet USDC balance — what's available to deposit. */
  usdcBalanceLabel: string | null;
  /** Subaccount USDC cash balance — what's held in the trading account. */
  accountUsdcLabel?: string | null;
  /** Subaccount cNGN balance. */
  accountCngnLabel?: string | null;
}) {
  const [chartTab, setChartTab] = useState<SpotChartTab>("price");
  const [timeframe, setTimeframe] = useState<SpotTimeframe>("1h");
  const [selectedTool, setSelectedTool] = useState("crosshair");
  const [indicatorsEnabled, setIndicatorsEnabled] = useState(false);
  const [bookTab, setBookTab] = useState<SpotBookTab>("book");
  const [bottomTab, setBottomTab] = useState<string>("positions");
  const [liveCandles, setLiveCandles] = useState<Candle[]>(candles);

  useEffect(() => {
    setLiveCandles(candles);
  }, [candles]);

  // No simulated ticking: candles are real venue OHLCV.

  const futuresBook = useMarketOrderBook({
    enabled: Boolean(marketDefinition.marketSymbol),
    market: marketDefinition.marketSymbol,
    type: "future",
  });

  const { changePercent, volumeLabel } = get24hStats(liveCandles, lastPrice, Date.now());
  const activityView = ACTIVITY_VIEWS[bottomTab as keyof typeof ACTIVITY_VIEWS] ?? {
    columns: [],
    rows: [],
  };
  // Prefer the live WebSocket book; fall back to the server-rendered snapshot for this market.
  const bookAsks = futuresBook.isLive ? futuresBook.asks : market.orderBookAsks;
  const bookBids = futuresBook.isLive ? futuresBook.bids : market.orderBookBids;
  const bookTrades =
    futuresBook.isLive && futuresBook.trades.length > 0 ? futuresBook.trades : market.trades;

  return (
    <div className="flex flex-col gap-3 xl:min-h-0 xl:flex-1 xl:overflow-hidden">
      <FuturesTickerBar
        basisLabel={basisLabel}
        changePercent24h={changePercent}
        contractSizeLabel={formatContractSize(marketDefinition.contractMultiplier)}
        expiryLabel={marketDefinition.expiryLabel ?? "—"}
        lastPrice={lastPrice}
        marketDefinition={marketDefinition}
        marketDefinitions={marketDefinitions}
        onSelectMarket={onSelectMarket}
        volume24hLabel={volumeLabel}
      />

      <div className="grid grid-cols-1 gap-3 xl:min-h-0 xl:flex-8 xl:grid-cols-[minmax(0,1fr)_270px_320px] xl:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_300px_340px]">
        <SpotChartPanel
          asks={bookAsks}
          bids={bookBids}
          candles={liveCandles}
          chartTab={chartTab}
          indicatorsEnabled={indicatorsEnabled}
          onChartTabChange={setChartTab}
          onIndicatorsToggle={() => setIndicatorsEnabled((current) => !current)}
          onTimeframeChange={setTimeframe}
          onToolSelect={setSelectedTool}
          selectedTimeframe={timeframe}
          selectedTool={selectedTool}
          timeframes={SPOT_TIMEFRAME_OPTIONS}
        />

        <SpotOrderBookPanel
          asks={bookAsks}
          bids={bookBids}
          lastPrice={lastPrice}
          onTabChange={setBookTab}
          tab={bookTab}
          trades={bookTrades}
        />

        {/*
         * `order-first` on phones only: in the stacked single column the ticket would sit
         * below the chart and order book, putting the submit button ~2.5 screens down the
         * document. The xl grid places columns explicitly, so order resets there.
         */}
        <div className="order-first flex min-h-[420px] flex-col gap-3 xl:order-0 xl:min-h-0 xl:overflow-hidden">
          <FuturesOrderFormPanel
            availableLabel={usdcBalanceLabel ?? "— USDC"}
            contractSizeLabel={formatContractSize(marketDefinition.contractMultiplier)}
            isPreparingAccount={isPreparingAccount}
            isSignedIn={isSignedIn}
            isSubmitting={isSubmitting}
            lastAction={lastAction}
            limitPrice={limitPrice}
            marketLabel={getInstrumentDisplayLabel(marketDefinition)}
            onDepositRequest={onDepositRequest}
            onLimitPriceChange={onLimitPriceChange}
            onOrderTypeChange={onOrderTypeChange}
            onSideChange={onSideChange}
            onSizeChange={onSizeChange}
            onSubmit={onSubmit}
            orderSide={orderSide}
            orderType={orderType}
            size={size}
            summaryRows={orderSummaryRows}
          />
          <SpotBalanceSummary
            cngnBalanceLabel={accountCngnLabel ?? "0.00 cNGN"}
            marginRatioPercent={0}
            usdcBalanceLabel={accountUsdcLabel ?? "— USDC"}
          />
        </div>
      </div>

      <div className="min-h-[200px] xl:min-h-0 xl:flex-2">
        <TradingActivityPanel
          activityView={activityView}
          footerLinks={FOOTER_LINKS}
          isSignedIn={isSignedIn}
          onTabSelect={setBottomTab}
          selectedTab={bottomTab}
          tabs={BOTTOM_TABS}
        />
      </div>
    </div>
  );
}
