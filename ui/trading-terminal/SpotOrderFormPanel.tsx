"use client";

import { ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { formatBalance, formatBalanceFigure } from "@/lib/account-balance-display";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/market-formatting";
import {
  getCrossingPrice,
  getMarketableLimitPrice,
  getMarketFill,
  getMaxOrderSize,
  getOrderCost,
  SPOT_MARKET_SLIPPAGE,
  toOrderSizeUsdc,
} from "@/lib/spot-market";
import { SPOT_ORDER_LIFETIME_LABEL, SPOT_TAKER_FEE_RATE } from "@/lib/spot-order-submission";
import type { OrderBookLevel } from "@/lib/trading.types";
import { ConfirmOrderDialog } from "@/ui/trading-terminal/ConfirmOrderDialog";
import { OrderTypeTabs } from "@/ui/trading-terminal/OrderTypeTabs";

/*
 * No "Stop Limit". The signed envelope this ticket produces is a plain limit action — it carries
 * a limit price, size, side, fee bound, nonce and expiry, and the `Matching` contract has no
 * trigger field to hang a stop on. The tab used to be offered anyway: the stop price was collected
 * into state that nothing read, so submitting sent an ordinary limit order at the limit price and
 * discarded the stop. A trader setting downside protection got a resting order instead.
 *
 * Nor is there a "Post only" toggle or a time-in-force selector, for the same reason: the envelope
 * has no flag for either. Every control on this ticket changes the order that gets signed.
 */
type SpotOrderType = "Limit" | "Market";
type PayCurrency = "cNGN" | "USDC";

const ORDER_TYPES = ["Limit", "Market"] as const satisfies readonly SpotOrderType[];

/** 5 bps taker tier as basis points, derived from the engine-bound rate so the two stay in sync. */
const SPOT_TAKER_FEE_BPS = Number(SPOT_TAKER_FEE_RATE) * 10_000;

/**
 * Market orders cross the opposing touch; everything else executes at the entered limit price.
 *
 * This previously sent the last traded price, which on a quiet market is days old and can rest
 * past the touch — a "market" order priced behind the book does not cross, so it silently rests
 * as a limit instead of filling.
 */
function resolveOrderPrice({
  crossingPrice,
  limitPrice,
  orderType,
}: {
  crossingPrice: number | null;
  limitPrice: string;
  orderType: SpotOrderType;
}) {
  if (orderType !== "Market") {
    return limitPrice;
  }

  return crossingPrice === null ? "" : String(crossingPrice);
}

function parseAmount(value: string) {
  // An empty field is "not entered", not zero: `Number("")` is 0, which rendered a total of
  // "0 cNGN" for an order with no price rather than leaving the row blank.
  if (value.trim() === "") {
    return Number.NaN;
  }

  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Copy and rows for the submit confirmation. Lives outside the component so its branching does
 * not count against the panel's cognitive complexity budget.
 */
function buildSpotConfirmation({
  amount,
  isBuy,
  orderType,
  takerFeeLabel,
  totalLabel,
}: {
  amount: string;
  isBuy: boolean;
  orderType: SpotOrderType;
  takerFeeLabel: string;
  totalLabel: string;
}) {
  const action = isBuy ? "buy" : "sell";

  return {
    confirmLabel: `Confirm ${action}`,
    description: `This submits a ${orderType.toLowerCase()} order for USDC/cNGN. It expires ${SPOT_ORDER_LIFETIME_LABEL} after signing if it has not filled, and once filled it cannot be reversed from this screen.`,
    directionLabel: isBuy ? "Buy USDC" : "Sell USDC",
    sizeLabel: `${amount || "0"} USDC`,
    title: `Confirm ${action}`,
    // The pay-with currency is deliberately omitted: it reads as "paying with" on a buy but the
    // trader receives that currency on a sell, and a confirmation should not assert either.
    summaryRows: [
      { label: isBuy ? "You pay" : "You receive", value: totalLabel },
      { label: `Taker fee (${SPOT_TAKER_FEE_BPS} bps)`, value: takerFeeLabel },
      { label: "Expires", value: `${SPOT_ORDER_LIFETIME_LABEL} after signing` },
    ],
  };
}

/** Taker fee is charged on the USDC notional (the order Amount), matching the signed worstFee bound. */
function formatSpotFee(usdc: number) {
  return `${usdc.toLocaleString("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 2 })} USDC`;
}

/**
 * Field with its label inside the box and an adornment on the right — the unit, or the quick-fill
 * buttons on the price field. Keeping the label in the box buys back a row of height per field,
 * which is what puts the submit button above the fold on a 667px screen.
 */
function FormField({
  adornment,
  id,
  label,
  onChange,
  placeholder,
  value,
}: {
  adornment?: ReactNode;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <div className="rounded-sm bg-input-bg px-3 py-1.5 ring-1 ring-panel-border focus-within:ring-panel-text-muted">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] text-panel-text-muted" htmlFor={id}>
          {label}
        </label>
        {adornment}
      </div>
      <input
        className="w-full bg-transparent font-semibold text-[15px] text-panel-text-active outline-none placeholder:text-panel-text-muted"
        id={id}
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, ""))}
        placeholder={placeholder}
        value={value}
      />
    </div>
  );
}

/** Fills the price field from the book — the mid, or the touch on the side the order would rest. */
function PriceQuickFill({
  bestLabel,
  bestPrice,
  midPrice,
  onSelect,
}: {
  bestLabel: string;
  bestPrice: number | null;
  midPrice: number | null;
  onSelect: (price: number) => void;
}) {
  return (
    <span className="flex items-center gap-1 text-[10px]">
      {[
        { label: "MID", price: midPrice },
        { label: bestLabel, price: bestPrice },
      ].map((option) => (
        <button
          className="cursor-pointer rounded-sm px-1.5 py-0.5 font-semibold text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text-active disabled:cursor-not-allowed disabled:opacity-40"
          disabled={option.price === null}
          key={option.label}
          onClick={() => option.price !== null && onSelect(option.price)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

/** One `label — value` line in the cost breakdown above the submit button. */
function CostRow({ emphasis, label, value }: { emphasis?: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-panel-text-muted">{label}</span>
      <span
        className={cn(
          "truncate",
          emphasis ? "font-semibold text-[13px] text-panel-text-active" : "text-panel-text"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Everything the ticket derives from the book, the entered values and the account balance.
 *
 * A pure function outside the component: it is where all the branching lives, and keeping it here
 * means the panel reads as layout rather than arithmetic.
 */
function deriveOrderEconomics({
  asks,
  bids,
  sizeUsdc,
  anchorPrice,
  availableCngn,
  availableUsdc,
  bestAsk,
  bestBid,
  limitPrice,
  orderType,
  side,
}: {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  /** The order size in USDC, already converted from whichever unit the Amount field is in. */
  sizeUsdc: number;
  anchorPrice: number | null;
  availableCngn: number | null;
  availableUsdc: number | null;
  bestAsk: number | null;
  bestBid: number | null;
  limitPrice: string;
  orderType: SpotOrderType;
  side: "buy" | "sell";
}) {
  const isBuy = side === "buy";
  const crossingPrice = getCrossingPrice(side, bestAsk, bestBid);
  const parsedAmount = sizeUsdc;
  const hasAmount = Number.isFinite(parsedAmount);
  /*
   * What a market order of this size would really fill at, walked through the resting depth. The
   * touch is only the first level: on a thin book the rest of the order fills behind it, so
   * quoting the touch understates the cost precisely when it matters most.
   */
  const fill = orderType === "Market" ? getMarketFill(side, asks, bids, parsedAmount) : null;
  // A market order costs what it crosses at — the walked average where the book can price it,
  // the touch until a size has been entered.
  const effectivePrice =
    orderType === "Market" ? (fill?.averagePrice ?? crossingPrice) : parseAmount(limitPrice);
  const hasPrice = effectivePrice !== null && Number.isFinite(effectivePrice);
  const total = hasPrice && hasAmount ? parsedAmount * (effectivePrice as number) : null;

  /*
   * Checked against the price the order is *signed* at, not the one it is expected to fill at. A
   * market order is signed through the touch, and the engine holds collateral against that limit —
   * so a buy that looks affordable at the ask can still be short of what the venue requires.
   */
  const enteredPrice = hasPrice ? (effectivePrice as number) : null;
  const signedPrice =
    orderType === "Market" ? getMarketableLimitPrice(side, bestAsk, bestBid) : enteredPrice;

  /*
   * The ceiling is priced off `signedPrice` for the same reason. Sized against the touch instead, a
   * market buy at 100% cost 0.5% more than the account held the moment it was sized — the slider's
   * own top notch produced an order the ticket then refused to submit.
   */
  const maxOrderSize = getMaxOrderSize({
    availableCngn,
    availableUsdc,
    isBuy,
    price: signedPrice ?? anchorPrice,
  });
  const canSizeByPercent = maxOrderSize !== null && maxOrderSize > 0;

  const cost = getOrderCost(side, signedPrice, parsedAmount);
  const availableForCost = cost?.currency === "USDC" ? availableUsdc : availableCngn;
  /*
   * A shortfall, not a rejection: the venue accepts an order the account cannot cover, rests it,
   * and lets it expire unfilled five minutes later — which reads as the order vanishing. Catching
   * it here is the only place a trader finds out before signing.
   */
  const shortfall =
    cost !== null && availableForCost !== null && cost.amount > availableForCost
      ? { currency: cost.currency, held: availableForCost, needed: cost.amount }
      : null;

  return {
    // Surfaced beside the fill itself so the panel never has to reach through it.
    averagePrice: fill === null ? null : fill.averagePrice,
    canSizeByPercent,
    crossingPrice,
    fill,
    shortfall,
    signedPrice,
    maxOrderSize,
    // Derived from the amount rather than held separately, so typing a size moves the slider and
    // the two can never disagree about what is being ordered.
    sizePercent:
      canSizeByPercent && hasAmount
        ? Math.min(100, Math.max(0, Math.round((parsedAmount / (maxOrderSize as number)) * 100)))
        : 0,
    takerFee: hasAmount ? parsedAmount * Number(SPOT_TAKER_FEE_RATE) : 0,
    totalLabel: total === null ? "—" : `${formatNaira(total, 0).replace("₦", "")} cNGN`,
  };
}

/** Buy/Sell selector. Tinted rather than filled, so the submit button stays the loudest control. */
function SideTabs({
  onSelect,
  side,
}: {
  onSelect: (side: "buy" | "sell") => void;
  side: "buy" | "sell";
}) {
  const isBuy = side === "buy";

  return (
    <div className="grid grid-cols-2 gap-1 rounded-sm bg-input-bg p-0.5">
      <button
        className={cn(
          "h-8 cursor-pointer rounded-sm font-semibold text-[12px] transition-colors",
          isBuy
            ? "bg-bid-bg text-buy ring-1 ring-buy/40"
            : "text-panel-text-muted hover:bg-input-hover"
        )}
        onClick={() => onSelect("buy")}
        type="button"
      >
        Buy
      </button>
      <button
        className={cn(
          "h-8 cursor-pointer rounded-sm font-semibold text-[12px] transition-colors",
          isBuy
            ? "text-panel-text-muted hover:bg-input-hover"
            : "bg-ask-bg text-sell ring-1 ring-sell/40"
        )}
        onClick={() => onSelect("sell")}
        type="button"
      >
        Sell
      </button>
    </div>
  );
}

/**
 * The balance an order draws on is the trading account's, not the connected wallet's — so this is
 * the number that answers "can I place this?". The plus opens the deposit dialog, which is the
 * action when the answer is no.
 *
 * The currency follows the selected side, because so does the balance an order spends: a buy pays
 * cNGN for USDC, a sell pays USDC. The figure is printed bare — the currency is already named one
 * gap to its left, and the ticker suffix the rest of the app uses would only repeat it.
 */
function AvailableRow({
  currency,
  label,
  onDepositRequest,
}: {
  currency: PayCurrency;
  label: string;
  onDepositRequest?: (currency: PayCurrency) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-panel-text-muted">Available ({currency})</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium text-panel-text">{label}</span>
        <button
          aria-label={`Deposit ${currency}`}
          className="flex size-4 cursor-pointer items-center justify-center rounded-full bg-input-bg text-[12px] text-panel-text-muted leading-none ring-1 ring-panel-border transition-colors hover:text-panel-text-active"
          onClick={() => onDepositRequest?.(currency)}
          type="button"
        >
          +
        </button>
      </span>
    </div>
  );
}

/**
 * Switches which leg the Amount field is denominated in.
 *
 * A market order is as often sized by what a trader wants to spend as by what they want to hold,
 * and on this pair those are different currencies. Only the USDC figure is submittable, so a cNGN
 * entry is converted at the price the order crosses at — the line under the field always shows the
 * other leg, so whichever way it is entered, both numbers are on screen before signing.
 */
function AmountUnitToggle({ onToggle, unit }: { onToggle: () => void; unit: PayCurrency }) {
  return (
    <button
      aria-label={`Amount in ${unit} — switch currency`}
      className="flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text-active"
      onClick={onToggle}
      type="button"
    >
      {unit}
      <ArrowUpDown aria-hidden className="size-3" />
    </button>
  );
}

/**
 * Sizes the order as a share of what the account can fund. Inert — and visibly so — when that
 * ceiling is unknown, rather than sliding against an invented balance.
 */
function SizeSlider({
  disabled,
  onChange,
  percent,
}: {
  disabled: boolean;
  onChange: (percent: number) => void;
  percent: number;
}) {
  return (
    <div>
      <input
        aria-label="Order size as a percentage of available balance"
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-input-bg accent-panel-text-active disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled}
        max={100}
        min={0}
        onChange={(event) => onChange(Number(event.target.value))}
        step={25}
        type="range"
        value={percent}
      />
    </div>
  );
}

/**
 * Resolves the CTA label. The wallet comes first — without one there is nothing to submit or
 * prepare, and submission rejects on the same condition. After that an in-flight order wins over
 * account preparation: once a submission starts, that is the more specific thing to wait on.
 *
 * A shortfall comes last and turns the button into the remedy rather than switching it off. A
 * disabled "Sell USDC" is a dead control: it states that the order cannot be placed and offers
 * nothing to do about it, which is the one blocker on this ticket the trader can clear themselves.
 */
function getSpotSubmitLabel({
  hasWallet,
  isPreparingAccount,
  isSubmitting,
  shortfallCurrency,
  sideLabel,
}: {
  hasWallet: boolean;
  isPreparingAccount: boolean;
  isSubmitting: boolean;
  /** The asset the account is short of, or null when the order is covered. */
  shortfallCurrency: PayCurrency | null;
  sideLabel: string;
}) {
  if (!hasWallet) {
    return "Deposit";
  }
  if (isSubmitting) {
    return "Submitting…";
  }
  if (isPreparingAccount) {
    return "Loading account…";
  }
  if (shortfallCurrency !== null) {
    return `Deposit ${shortfallCurrency}`;
  }
  return sideLabel;
}

/**
 * Rounds a slider-derived size *down* to the field's four decimals.
 *
 * `toFixed` rounds to nearest, which at 100% can land a hair above what the account holds — and a
 * hair is enough for the ticket to call the order unaffordable. Flooring keeps the top notch of the
 * slider exactly at the affordable max.
 */
function toAffordableSize(size: number) {
  return (Math.floor(size * 10_000) / 10_000).toFixed(4);
}

/**
 * The same order counted in the other leg, for the line under the Amount field.
 *
 * Null — rendered as an em dash — whenever the book cannot price the conversion. A market ticket
 * with no touch has no honest counterpart to show, and inventing one would put a number on screen
 * that nothing can fill at.
 */
function getCounterpart({
  averagePrice,
  conversionPrice,
  sizeUsdc,
  unit,
}: {
  /** The walked fill average, where the book has one; it is what the Total is priced at. */
  averagePrice: number | null;
  conversionPrice: number | null;
  sizeUsdc: number;
  unit: PayCurrency;
}) {
  const currency: PayCurrency = unit === "USDC" ? "cNGN" : "USDC";
  // The same price the Total uses, so the two are one quantity rather than two nearby ones.
  const price = averagePrice ?? conversionPrice;

  if (!Number.isFinite(sizeUsdc) || price === null) {
    return formatBalance(null, currency);
  }

  // Entered in cNGN, `sizeUsdc` is already the counterpart; entered in USDC, it has to be priced.
  return formatBalance(unit === "USDC" ? sizeUsdc * price : sizeUsdc, currency);
}

/**
 * Rewrites the Amount field when its currency changes, carrying the order across rather than the
 * digits: what was 100 USDC becomes the cNGN it costs, not a 100 cNGN order a hundredth the size.
 * Returns null when there is no price to convert at, which leaves whatever was typed alone.
 */
function convertAmountToUnit(amount: number, nextUnit: PayCurrency, price: number | null) {
  if (!Number.isFinite(amount) || price === null || price <= 0) {
    return null;
  }

  return toAffordableSize(nextUnit === "cNGN" ? amount * price : amount / price);
}

/**
 * How the Amount field is denominated, and the order that entry describes.
 *
 * Everything downstream works in USDC — the ceiling, the cost, the fee, the signed envelope — so
 * this is where a cNGN entry becomes a USDC size, once, rather than at each of those call sites.
 * The counterpart shown under the field is priced later, off the walked average this size produces.
 */
function deriveAmountEntry({
  amount,
  anchorPrice,
  bestAsk,
  bestBid,
  isMarket,
  side,
  unit,
}: {
  amount: string;
  anchorPrice: number | null;
  bestAsk: number | null;
  bestBid: number | null;
  isMarket: boolean;
  side: "buy" | "sell";
  unit: PayCurrency;
}) {
  // A limit ticket is always in USDC, so the unit resets with the tab rather than carrying a cNGN
  // entry into a field that no longer offers the switch.
  const activeUnit: PayCurrency = isMarket ? unit : "USDC";
  const parsedAmount = parseAmount(amount);
  /*
   * The conversion runs off the touch rather than the walked average, which would depend on the
   * size this very conversion produces. The average is then walked for the size that results.
   */
  const conversionPrice = getCrossingPrice(side, bestAsk, bestBid) ?? anchorPrice;
  const sizeUsdc = toOrderSizeUsdc(parsedAmount, activeUnit, conversionPrice);

  return { activeUnit, conversionPrice, parsedAmount, sizeUsdc };
}

/** The Amount field's trailing control: a currency switch on a market ticket, a label otherwise. */
function AmountAdornment({
  isMarket,
  onToggle,
  unit,
}: {
  isMarket: boolean;
  onToggle: () => void;
  unit: PayCurrency;
}) {
  if (!isMarket) {
    return <span className="text-[10px] text-panel-text-muted">USDC</span>;
  }

  return <AmountUnitToggle onToggle={onToggle} unit={unit} />;
}

/**
 * The other leg of the same order, so a size entered in one currency is never signed without its
 * counterpart on screen. An em dash until the book can price it: a conversion needs a touch, and
 * inventing one would put a number on screen that nothing can fill at.
 */
function ConversionLine({ isMarket, label }: { isMarket: boolean; label: string }) {
  if (!isMarket) {
    return null;
  }

  return <p className="text-[10px] text-panel-text-muted">≈ {label}</p>;
}

/** What a market order fills at, and the room it is signed with. A limit ticket has neither. */
function MarketFillRows({
  averagePrice,
  isMarket,
}: {
  averagePrice: number | null;
  isMarket: boolean;
}) {
  if (!isMarket) {
    return null;
  }

  return (
    <>
      {/*
       * What the order fills at, walked through the resting depth rather than quoted off the
       * touch — on a thin book the two are not the same number, and the average is the one the
       * trader is charged.
       */}
      <CostRow label="Average price" value={formatNaira(averagePrice)} />
      {/*
       * Not a cost: the room the order has to still cross if the quote moves between signing and
       * settlement. The fill itself lands at the maker's price, which `Average price` above quotes.
       */}
      <CostRow label="Slippage" value={`<${(SPOT_MARKET_SLIPPAGE * 100).toFixed(1)}%`} />
    </>
  );
}

/**
 * How long an order that does not fill stays on the book.
 *
 * A limit ticket's most surprising term — it leaves the book on its own and nothing else on screen
 * would say so. A market order crosses on submission, so the lifetime only ever applies to a
 * remainder the book could not cover, which the depth note above already names.
 */
function OrderLifetimeRow({ isMarket }: { isMarket: boolean }) {
  if (isMarket) {
    return null;
  }

  return <CostRow label="Expires" value={`${SPOT_ORDER_LIFETIME_LABEL} after signing`} />;
}

/**
 * A market order larger than the book: the venue fills what rests and leaves the remainder working
 * at the signed limit until it expires. Muted rather than red — it is the venue behaving normally,
 * not the order being refused.
 *
 * Stands down while a shortfall is showing. That note is about an order that cannot be funded at
 * all, which settles the question this one is a footnote to — and stacked, the two pushed the
 * column past its height on a 700px viewport.
 */
function MarketDepthNote({
  fill,
  hasShortfall,
}: {
  fill: { filledSize: number; isFullyFilled: boolean } | null;
  hasShortfall: boolean;
}) {
  if (hasShortfall || fill === null || fill.isFullyFilled || fill.filledSize <= 0) {
    return null;
  }

  return (
    <p className="text-[10px] text-panel-text-muted leading-snug">
      Book covers {formatBalance(fill.filledSize, "USDC")} — the rest rests until it expires.
    </p>
  );
}

export function SpotOrderFormPanel({
  anchorPrice,
  asks,
  availableCngn,
  availableUsdc,
  bestAsk,
  bestBid,
  bids,
  onDepositRequest,
  onSubmitOrder,
  isPreparingAccount = false,
  hasWallet = false,
  isSubmitting = false,
  lastAction = null,
}: {
  /** Mid of the displayed book — seeds the limit price, and cannot cross on either side. */
  anchorPrice: number | null;
  /**
   * The ladder as displayed, so a market order's average price is walked through the same depth
   * the trader is looking at rather than estimated off the touch.
   */
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  /**
   * What a new order can actually spend: the trading-account balance less what this trader's own
   * resting orders already claim. The connected wallet's balance funds a deposit, not an order, so
   * it belongs in the deposit dialog rather than here.
   *
   * `Available` is formatted from these numbers rather than taking a label of its own — the two used
   * to arrive separately, and the label was the *balance* while the number was the spendable part,
   * so a trader with orders resting read a figure the slider would not size to.
   */
  availableCngn: number | null;
  availableUsdc: number | null;
  /** The touch as displayed in the ladder, so the ticket quotes the book on screen. */
  bestAsk: number | null;
  bestBid: number | null;
  /**
   * Opens the deposit dialog — what the CTA does before a wallet is connected, and what it does
   * instead of going dead when the account is short of the asset this order spends.
   */
  onDepositRequest?: (currency?: PayCurrency) => void;
  onSubmitOrder: (args: {
    side: "buy" | "sell";
    price: string;
    size: string;
    orderType: SpotOrderType;
  }) => void;
  /** The trading subaccount is still being resolved — distinct from an order in flight. */
  isPreparingAccount?: boolean;
  /**
   * Whether a wallet is connected. This, not a Privy session, is what order submission and the
   * deposit flow require, so the CTA points at funding whenever it is false.
   */
  hasWallet?: boolean;
  isSubmitting?: boolean;
  lastAction?: string | null;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<SpotOrderType>("Limit");
  // Seeded from the mid, not the last trade: a prefill past the touch turns the trader's chosen
  // "Limit" into a taker on submit — an immediate fill at the 5 bps tier instead of resting free.
  const [limitPrice, setLimitPrice] = useState(
    anchorPrice === null ? "" : String(anchorPrice.toFixed(2))
  );
  const [amount, setAmount] = useState("100");
  // Which leg the Amount field is counted in. USDC is the order's own notional; cNGN is what the
  // trader spends or receives. Market orders alone offer the switch — a limit order is priced by
  // the trader, so its size is the one number the ticket should not be restating for them.
  const [amountUnit, setAmountUnit] = useState<PayCurrency>("USDC");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isBuy = side === "buy";
  const needsLimitPrice = orderType !== "Market";
  const isMarket = orderType === "Market";
  const spendCurrency: PayCurrency = isBuy ? "cNGN" : "USDC";
  const { activeUnit, conversionPrice, parsedAmount, sizeUsdc } = deriveAmountEntry({
    amount,
    anchorPrice,
    bestAsk,
    bestBid,
    isMarket,
    side,
    unit: amountUnit,
  });
  const availableLabel = formatBalanceFigure(
    spendCurrency === "USDC" ? availableUsdc : availableCngn,
    spendCurrency
  );
  const {
    averagePrice,
    canSizeByPercent,
    crossingPrice,
    fill,
    maxOrderSize,
    shortfall,
    sizePercent,
    takerFee,
    totalLabel,
  } = deriveOrderEconomics({
    anchorPrice,
    asks,
    availableCngn,
    availableUsdc,
    bestAsk,
    bestBid,
    bids,
    limitPrice,
    orderType,
    side,
    sizeUsdc,
  });

  const counterpartLabel = getCounterpart({
    averagePrice,
    conversionPrice,
    sizeUsdc,
    unit: activeUnit,
  });

  const confirmation = buildSpotConfirmation({
    amount: Number.isFinite(sizeUsdc) ? toAffordableSize(sizeUsdc) : "",
    isBuy,
    orderType,
    takerFeeLabel: formatSpotFee(takerFee),
    totalLabel,
  });

  function handleSizePercent(percent: number) {
    if (!canSizeByPercent) {
      return;
    }
    // The ceiling is a USDC size; the field may be counting cNGN, so the notch is written back in
    // the unit on screen rather than dropping a USDC figure into a cNGN field.
    const sizeAtPercent = (maxOrderSize as number) * (percent / 100);
    const inCngn =
      activeUnit === "cNGN" ? convertAmountToUnit(sizeAtPercent, "cNGN", conversionPrice) : null;
    setAmount(inCngn ?? toAffordableSize(sizeAtPercent));
  }

  /** Switches the Amount field's currency, converting what is in it to match. */
  function handleUnitToggle() {
    const nextUnit: PayCurrency = amountUnit === "USDC" ? "cNGN" : "USDC";
    setAmountUnit(nextUnit);

    const converted = convertAmountToUnit(parsedAmount, nextUnit, conversionPrice);
    if (converted !== null) {
      setAmount(converted);
    }
  }

  function handleSubmit() {
    // Without a wallet there is nothing to submit against, so the CTA funds an account instead.
    if (!hasWallet) {
      onDepositRequest?.();
      return;
    }
    // Same move for the one blocker a trader can clear from here: the ticket sends them to the
    // dialog for the asset it named, rather than refusing the order and stopping there.
    if (shortfall !== null) {
      onDepositRequest?.(shortfall.currency);
      return;
    }
    setConfirmOpen(true);
  }

  function handleConfirm() {
    setConfirmOpen(false);
    onSubmitOrder({
      orderType,
      price: resolveOrderPrice({ crossingPrice, limitPrice, orderType }),
      side,
      // Always the USDC notional: the signed envelope carries no other unit, so a cNGN-denominated
      // ticket is converted here rather than sending the figure the trader typed.
      size: toAffordableSize(sizeUsdc),
    });
  }

  const statusText = lastAction;
  const sideLabel = isBuy ? "Buy USDC" : "Sell USDC";
  // Both states block submission, but they are not the same thing: "Submitting…" on a button the
  // user never pressed reads as a stuck order rather than a subaccount lookup still in flight.
  const isBusy = isSubmitting || isPreparingAccount;
  // Only meaningful for a trader who has an account to measure against: with no wallet the CTA
  // already funds one, and there is no balance to be short of yet.
  const shortfallCurrency = hasWallet && shortfall !== null ? shortfall.currency : null;
  const submitLabel = getSpotSubmitLabel({
    hasWallet,
    isPreparingAccount,
    isSubmitting,
    shortfallCurrency,
    sideLabel,
  });

  return (
    /*
     * `min-h-fit` is what keeps the fields on screen: the ticket shares its column with the
     * balance summary, and as a plain flex child it gave up whatever height the summary took —
     * on a 700px window that left the price and amount fields a ~20px sliver behind an inner
     * scrollbar. Refusing to shrink below its own content makes the *column* scroll instead,
     * and the footer below sticks so the submit button never leaves the viewport.
     */
    <section className="flex flex-col overflow-clip bg-panel-bg-muted ring-1 ring-panel-ring transition-colors duration-300 md:min-h-fit md:flex-1">
      {/*
       * The panel label only earns its space next to sibling panels. In the stacked
       * sub-xl layout this is the only form on screen, so the row is dropped there to
       * keep the submit button within the first screenful.
       */}
      <div className="hidden shrink-0 items-center border-panel-border border-b px-3 py-1.5 font-medium text-[11px] md:flex">
        <span className="rounded-sm bg-input-bg px-2 py-0.5 text-panel-text-active">
          Order form
        </span>
      </div>

      {/* No scroller of its own — the column is the one scroll region, so a squeezed ticket
          scrolls the whole column rather than hiding fields inside an unmarked box. */}
      <div className="space-y-1.5 px-3 py-1.5 md:min-h-0 md:flex-1">
        <SideTabs onSelect={setSide} side={side} />

        <OrderTypeTabs onSelect={setOrderType} orderTypes={ORDER_TYPES} selected={orderType} />

        <AvailableRow
          currency={spendCurrency}
          label={availableLabel}
          onDepositRequest={onDepositRequest}
        />

        {needsLimitPrice ? (
          <FormField
            adornment={
              <PriceQuickFill
                bestLabel={isBuy ? "BID" : "ASK"}
                bestPrice={isBuy ? bestBid : bestAsk}
                midPrice={anchorPrice}
                onSelect={(price) => setLimitPrice(price.toFixed(2))}
              />
            }
            id="spot-limit-price"
            label="Limit price (cNGN)"
            onChange={setLimitPrice}
            placeholder="0.00"
            value={limitPrice}
          />
        ) : null}

        <FormField
          adornment={
            <AmountAdornment isMarket={isMarket} onToggle={handleUnitToggle} unit={activeUnit} />
          }
          id="spot-amount"
          label="Amount"
          onChange={setAmount}
          placeholder="0.0000"
          value={amount}
        />

        <ConversionLine isMarket={isMarket} label={counterpartLabel} />

        <SizeSlider
          disabled={!canSizeByPercent}
          onChange={handleSizePercent}
          percent={sizePercent}
        />
      </div>

      {/*
       * Fees and the submit CTA stay pinned so the primary action is never scrolled out of reach —
       * sticky to the column's scrollport, so on a viewport too short for the whole ticket the CTA
       * rides at the bottom of the column instead of sitting below the fold.
       */}
      <div className="shrink-0 space-y-2 border-panel-border border-t bg-panel-bg-muted px-3 pt-1.5 pb-2 md:sticky md:bottom-0 md:z-10">
        {/*
         * One total, not a Subtotal/Total pair. The fee is charged on the USDC leg while the total
         * is the cNGN one, so Total never differs from Subtotal — printing both implied the fee was
         * added into it, and cost the two rows the Amount field needed on a 700px screen.
         */}
        <div className="space-y-1 text-[11px]">
          <CostRow emphasis label="Total" value={totalLabel} />
          {/*
           * Approximate, and marked so: this is the taker charge on the whole order, and an order
           * that only partly fills — or rests and never takes at all — is charged less. The figure
           * is the ceiling the envelope is signed with, not a quote.
           */}
          <CostRow label="Fee" value={`~${formatSpotFee(takerFee)}`} />
          <MarketFillRows averagePrice={averagePrice} isMarket={isMarket} />
          <OrderLifetimeRow isMarket={isMarket} />
        </div>

        <MarketDepthNote fill={fill} hasShortfall={shortfallCurrency !== null} />

        {shortfall === null || !hasWallet ? null : (
          <p className="text-[10px] text-sell leading-snug">
            Needs {formatBalance(shortfall.needed, shortfall.currency)}; account holds{" "}
            {formatBalance(shortfall.held, shortfall.currency)}.
          </p>
        )}

        <button
          className={cn(
            "h-10 w-full cursor-pointer rounded-sm font-semibold text-[13px] transition-colors",
            isBuy
              ? "bg-buy text-background hover:bg-buy/90"
              : "bg-sell text-white hover:bg-sell/90",
            // Neutral once it stops being an order button, so the trader is not asked to press a
            // green "Buy"-coloured control that will open a deposit dialog.
            shortfallCurrency !== null &&
              "bg-input-bg text-panel-text-active ring-1 ring-panel-border hover:bg-input-hover",
            isBusy && "cursor-wait opacity-70"
          )}
          disabled={isBusy}
          // Stable hook for the layout invariant check: the label changes with wallet and
          // submission state ("Deposit", "Submitting…", "Buy USDC"), so text is not an identifier.
          id="spot-submit-cta"
          onClick={handleSubmit}
          type="button"
        >
          {submitLabel}
        </button>

        <ConfirmOrderDialog
          {...confirmation}
          isSubmitting={isSubmitting}
          onConfirm={handleConfirm}
          onOpenChange={setConfirmOpen}
          open={confirmOpen}
          orderSide={side}
        />

        {statusText === null ? null : (
          <p className="text-[10px] text-panel-text-muted leading-snug">{statusText}</p>
        )}
      </div>
    </section>
  );
}
