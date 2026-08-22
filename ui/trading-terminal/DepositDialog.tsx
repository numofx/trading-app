"use client";

import { Dialog } from "@base-ui/react/dialog";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { ArrowLeft, ChevronRight, Landmark, Wallet, X } from "lucide-react";
import { formatAddressShort } from "@/lib/address-display";
import { cn } from "@/lib/cn";
import type {
  DepositBlockedReason,
  DepositCurrency,
  DepositFlowState,
} from "@/lib/subaccount-deposit.types";
import type { WithdrawableAsset } from "@/lib/withdrawable-assets";
import { SmartImage } from "@/ui/SmartImage";
import type { AssetOption } from "@/ui/trading-terminal/transfer-dialog-state";
import {
  getAmountFontClass,
  getPickerTitles,
  getTokenIconSrc,
} from "@/ui/trading-terminal/transfer-dialog-state";
import type { WithdrawFlowState } from "@/ui/trading-terminal/useSubaccountWithdraw";
import { useTransferDialog } from "@/ui/trading-terminal/useTransferDialog";

/**
 * The wallet a deposit would come from, and the trading account it would land in.
 *
 * The two are one value on purpose. As separate props, "a subaccount with no wallet" was
 * expressible, and that is exactly the state the dialog rendered when it offered to fund account
 * #11 for a visitor it had no address for. Here it does not typecheck.
 */
export type DepositAccount = {
  /** null until this wallet's first deposit creates one. */
  subaccountId: string | null;
  wallet: ConnectedWallet;
};

/** A wallet-held ERC-20 balance, keyed by the currency it belongs to. */
export type DepositWalletBalances = Partial<
  Record<DepositCurrency, { decimals: number; units: bigint } | null>
>;

/** Pairs a wallet with its resolved subaccount, or null when no wallet is connected. */
export function buildDepositAccount(
  wallet: ConnectedWallet | null,
  subaccountId: string | null
): DepositAccount | null {
  return wallet === null ? null : { subaccountId, wallet };
}

/** What to call a connected wallet: its own name where it has one, the client type otherwise. */
function getWalletLabel(wallet: ConnectedWallet) {
  if (wallet.walletClientType === "privy") {
    return "Embedded wallet";
  }

  const name = wallet.meta?.name?.trim();
  return name === undefined || name === "" ? wallet.walletClientType : name;
}

function getBlockedCopy(reason: DepositBlockedReason, isCreatePath: boolean) {
  if (reason === "zero-amount") {
    return "Enter an amount greater than zero.";
  }

  if (reason === "insufficient-balance") {
    return "Your wallet balance is below the deposit amount.";
  }

  if (isCreatePath) {
    return "Deposits are whitelist-gated on this deployment, and a brand-new trading account cannot be pre-approved. Ask the venue operator to whitelist your account or disable the whitelist.";
  }

  return "This trading account is not approved for deposits yet. Ask the venue operator to whitelist it.";
}

function getStepCopy(flowState: DepositFlowState, currency: DepositCurrency) {
  switch (flowState.status) {
    case "preflight":
      return "Checking balance, allowance, and deposit permissions...";
    case "awaiting-approval":
      return `Step 1 of 2 — approve ${currency} so the venue can pull your deposit.`;
    case "approving":
      return "Waiting for the approval transaction to confirm...";
    case "awaiting-deposit":
      return "Step 2 of 2 — confirm the deposit transaction.";
    case "depositing":
      return "Waiting for the deposit transaction to confirm...";
    default:
      return null;
  }
}

const PRIMARY_BUTTON_CLASSES =
  "min-h-[52px] flex-1 cursor-pointer rounded-[16px] bg-foreground font-semibold text-[14px] text-background transition-colors hover:bg-foreground/90";

const SECONDARY_BUTTON_CLASSES =
  "min-h-[52px] flex-1 cursor-pointer rounded-[16px] bg-input-bg font-semibold text-[14px] text-panel-text ring-1 ring-panel-border transition-colors hover:bg-input-hover";

/**
 * First step for a visitor with no wallet. The deposit form itself is useless without one — there
 * is no address to pull USDC from — so the dialog offers login instead of a dead disabled field.
 */
function ConnectWalletStep({ onConnectWallet }: { onConnectWallet?: () => void }) {
  if (onConnectWallet === undefined) {
    return null;
  }

  return (
    <button
      className={cn(PRIMARY_BUTTON_CLASSES, "mt-5 w-full")}
      onClick={onConnectWallet}
      type="button"
    >
      Connect wallet
    </button>
  );
}

/**
 * One leg of the route the money takes: an icon disc, what it is, an optional right-hand value,
 * and an optional control parked after it (Max, on the funding leg).
 */
function RouteRow({
  action,
  detail,
  icon,
  label,
  onOpen,
  openLabel,
  value,
  valueCaption,
}: {
  action?: React.ReactNode;
  detail: string;
  icon: React.ReactNode;
  label: string;
  /** Makes the whole row a navigation target. */
  onOpen?: () => void;
  /** Accessible name for that target, since its own text sits outside the button. */
  openLabel?: string;
  value?: string | null;
  valueCaption?: string;
}) {
  return (
    <div className="relative flex items-center gap-3">
      {/*
       * A stretched button rather than a button wrapping the row: Max lives in here too, and
       * nesting one button inside another is invalid. The row's own content is inert so clicks
       * fall through to this, while Max sits above it and keeps its own hit area.
       */}
      {onOpen === undefined ? null : (
        <button
          aria-label={openLabel}
          className="absolute -inset-x-2 -inset-y-1.5 cursor-pointer rounded-[14px] transition-colors hover:bg-input-hover"
          onClick={onOpen}
          type="button"
        />
      )}
      <span className="pointer-events-none relative flex size-8 shrink-0 items-center justify-center rounded-full bg-input-bg text-panel-text-muted ring-1 ring-panel-border">
        {icon}
      </span>
      <div className="pointer-events-none relative min-w-0 flex-1">
        <p className="font-semibold text-[13px] text-panel-text-active">{label}</p>
        <p className="truncate text-[12px] text-panel-text-muted">{detail}</p>
      </div>
      {value === null || value === undefined ? null : (
        <div className="pointer-events-none relative shrink-0 text-right">
          <p className="font-semibold text-[13px] text-panel-text-active">{value}</p>
          {valueCaption === undefined ? null : (
            <p className="text-[12px] text-panel-text-muted">{valueCaption}</p>
          )}
        </div>
      )}
      {/* Positioned, so it paints above the stretched button and keeps its own clicks. */}
      {action === undefined ? null : <span className="relative shrink-0">{action}</span>}
      {onOpen === undefined ? null : (
        <ChevronRight className="pointer-events-none relative size-4 shrink-0 text-panel-text-muted" />
      )}
    </div>
  );
}

/**
 * What is being sent, and out of which wallet.
 *
 * The funding address has a row of its own because a bare "trading account #11" carries no
 * provenance: it cannot distinguish the viewer's own account from a stale one, which is what made
 * an earlier bug so hard to read off a screenshot. An address on screen means a wallet is
 * connected, and says which. The destination is named in the dialog's description line.
 */
function TransferRoute({
  account,
  balanceLabel,
  currency,
  onMax,
  onPickAsset,
  onPickWallet,
}: {
  account: DepositAccount;
  balanceLabel: string | null;
  currency: DepositCurrency;
  /** Omitted mid-flow, and null when there is no balance to spend. */
  onMax?: (() => void) | null;
  /** Omitted mid-flow, when the asset is already committed to a running deposit. */
  onPickAsset?: () => void;
  /** Omitted mid-flow, when the asset and payer are committed to a running deposit. */
  onPickWallet?: () => void;
}) {
  return (
    <div className="mt-6">
      <RouteRow
        action={
          onMax === null || onMax === undefined ? null : (
            <button
              className="shrink-0 cursor-pointer rounded-full bg-input-bg px-3.5 py-1.5 font-semibold text-[12px] text-panel-text-active ring-1 ring-panel-border transition-colors hover:bg-input-hover"
              onClick={onMax}
              type="button"
            >
              Max
            </button>
          )
        }
        detail={currency}
        icon={
          <SmartImage<string>
            alt={currency}
            className="size-8 animate-none"
            src={getTokenIconSrc(currency)}
          />
        }
        label="Deposit"
        onOpen={onPickAsset}
        openLabel={`Change deposit asset, currently ${currency}`}
        value={balanceLabel}
        valueCaption={balanceLabel === null ? undefined : "Available"}
      />
      {/* Ties the two rows into one route; centered on the 32px icon discs above and below. */}
      <div className="my-1.5 ml-4 h-4 w-px bg-panel-border" />
      <RouteRow
        detail={formatAddressShort(account.wallet.address)}
        icon={<Wallet className="size-4" />}
        label="Transfer from"
        onOpen={onPickWallet}
        openLabel="Change the wallet this deposit is paid from"
      />
    </div>
  );
}

/**
 * The withdraw counterpart to {@link TransferRoute}: which asset leaves the trading account, and
 * which wallet receives it. The balance here is the on-ledger account balance, not the wallet's —
 * that is what a withdrawal can actually draw on.
 */
function WithdrawRoute({
  account,
  asset,
  balanceLabel,
  onMax,
  onPickAsset,
  onPickDestination,
}: {
  account: DepositAccount;
  asset: WithdrawableAsset;
  balanceLabel: string | null;
  onMax?: (() => void) | null;
  onPickAsset?: () => void;
  onPickDestination?: () => void;
}) {
  return (
    <div className="mt-6">
      <RouteRow
        action={
          onMax === null || onMax === undefined ? null : (
            <button
              className="shrink-0 cursor-pointer rounded-full bg-input-bg px-3.5 py-1.5 font-semibold text-[12px] text-panel-text-active ring-1 ring-panel-border transition-colors hover:bg-input-hover"
              onClick={onMax}
              type="button"
            >
              Max
            </button>
          )
        }
        detail={asset.label}
        icon={
          <SmartImage<string>
            alt={asset.symbol}
            className="size-8 animate-none"
            src={getTokenIconSrc(asset.symbol)}
          />
        }
        label="Withdraw"
        onOpen={onPickAsset}
        openLabel={`Change withdrawal asset, currently ${asset.label}`}
        value={balanceLabel}
        valueCaption={balanceLabel === null ? undefined : "In account"}
      />
      <div className="my-1.5 ml-4 h-4 w-px bg-panel-border" />
      <RouteRow
        detail={formatAddressShort(account.wallet.address)}
        icon={<Wallet className="size-4" />}
        label="Transfer to"
        onOpen={onPickDestination}
        openLabel="Change the wallet this withdrawal is sent to"
      />
    </div>
  );
}

/**
 * The hero amount: an auto-widening number with the asset ticker parked against it, so the pair
 * reads as one figure rather than a labelled text field.
 */
function AmountField({
  amount,
  currency,
  label = "Deposit",
  onAmountChange,
}: {
  amount: string;
  /** Ticker parked against the number — a symbol, not necessarily a depositable currency. */
  currency: string;
  /** Names the field for screen readers; the visible ticker is the same either way. */
  label?: string;
  /** Read-only rendering (mid-flow) when omitted. */
  onAmountChange?: (amount: string) => void;
}) {
  const displayed = amount === "" ? "0" : amount;
  const fontClass = getAmountFontClass(displayed);
  const typeClasses = cn("font-semibold tracking-tight", fontClass);

  return (
    <div className="mt-5 flex items-center">
      <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
        {onAmountChange === undefined ? (
          <span className={cn(typeClasses, "truncate text-panel-text-active")}>{displayed}</span>
        ) : (
          /* Type classes sit on the wrapper: the global `input { font: inherit }` rule is
             unlayered and so outranks any font utility put on the input itself. */
          <span className={cn(typeClasses, "inline-grid min-w-0 overflow-hidden")}>
            {/* Sizer: gives the grid cell the width of the typed digits so the input hugs them. */}
            <span aria-hidden="true" className="invisible col-start-1 row-start-1 whitespace-pre">
              {displayed}
            </span>
            <input
              aria-label={`${label} amount in ${currency}`}
              className="col-start-1 row-start-1 w-0 min-w-full bg-transparent text-panel-text-active outline-none placeholder:text-panel-text"
              id="deposit-amount"
              inputMode="decimal"
              /* Past this the digits stop fitting the popup even at the smallest tier. */
              maxLength={18}
              onChange={(event) => onAmountChange(event.target.value.replace(/[^\d.,]/g, ""))}
              placeholder="0"
              value={amount}
            />
          </span>
        )}
        <span className={cn(typeClasses, "shrink-0 text-panel-text-muted")}>{currency}</span>
      </div>
    </div>
  );
}

/**
 * Stands in for the amount step when the selected currency's deposits are closed.
 *
 * A disabled button would say "no" without saying why, and the why matters here: the money would
 * go somewhere it cannot come back from. The other asset is offered when there is one.
 */
function DepositPaused({ onPickAsset, reason }: { onPickAsset: () => void; reason: string }) {
  return (
    <>
      <p className="mt-5 text-[13px] text-panel-text">{reason}</p>
      <button
        className={cn(SECONDARY_BUTTON_CLASSES, "mt-5 w-full")}
        onClick={onPickAsset}
        type="button"
      >
        Choose another asset
      </button>
    </>
  );
}

/** The amount step: what to send, where it comes from, where it lands, and the CTA. */
function DepositForm({
  account,
  amount,
  balanceLabel,
  currency,
  inputError,
  onAmountChange,
  onMax,
  onPickAsset,
  onPickWallet,
  onSubmit,
  pauseReason,
}: {
  account: DepositAccount;
  amount: string;
  balanceLabel: string | null;
  currency: DepositCurrency;
  inputError: string | null;
  onAmountChange: (amount: string) => void;
  onMax: (() => void) | null;
  onPickAsset: () => void;
  onPickWallet: (() => void) | null;
  onSubmit: () => void;
  /** Non-null when this currency cannot be deposited right now. */
  pauseReason: string | null;
}) {
  if (pauseReason !== null) {
    return <DepositPaused onPickAsset={onPickAsset} reason={pauseReason} />;
  }

  return (
    <>
      <AmountField amount={amount} currency={currency} onAmountChange={onAmountChange} />
      {inputError === null ? null : <p className="mt-2 text-[12px] text-ask-text">{inputError}</p>}
      <TransferRoute
        account={account}
        balanceLabel={balanceLabel}
        currency={currency}
        onMax={onMax}
        onPickAsset={onPickAsset}
        onPickWallet={onPickWallet ?? undefined}
      />
      <button
        className={cn(PRIMARY_BUTTON_CLASSES, "mt-6 w-full")}
        onClick={onSubmit}
        type="button"
      >
        Review deposit
      </button>
    </>
  );
}

/** Back / title / close, shared by the drill-down screens so they stay one shape. */
function PickerHeader({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <button
          aria-label="Back"
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-input-bg text-panel-text transition-colors hover:bg-input-hover"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft className="size-4" />
        </button>
        <Dialog.Title className="flex-1 text-center font-semibold text-[15px] text-panel-text-active">
          {title}
        </Dialog.Title>
        <Dialog.Close
          aria-label="Close deposit dialog"
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text"
        >
          <X className="size-4" />
        </Dialog.Close>
      </div>
      {/* Full-bleed rule: the list below reads as its own surface, as in the deposit screen. */}
      <div className="-mx-6 mt-4 border-panel-border border-t" />
    </>
  );
}

/** One row of the asset screen: a token mark, a name, and what is behind it. */
function AssetRow({
  balanceCaption,
  balanceLabel,
  disabledReason,
  iconSrc,
  isSelected,
  label,
  onSelect,
}: {
  balanceCaption: string;
  balanceLabel: string | null;
  disabledReason?: string;
  iconSrc: string;
  isSelected: boolean;
  label: string;
  onSelect: () => void;
}) {
  const isDisabled = disabledReason !== undefined;

  return (
    <button
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-[14px] px-2 py-3 text-left transition-colors",
        isDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-input-hover",
        isSelected && !isDisabled && "bg-input-bg"
      )}
      disabled={isDisabled}
      onClick={onSelect}
      type="button"
    >
      <SmartImage<string>
        alt={label}
        className="size-8 shrink-0 animate-none rounded-full"
        src={iconSrc}
      />
      <span className="min-w-0 flex-1 truncate font-semibold text-[14px] text-panel-text-active">
        {label}
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-semibold text-[14px] text-panel-text-active">
          {balanceLabel ?? "—"}
        </span>
        <span className="block text-[12px] text-panel-text-muted">
          {disabledReason ?? (balanceLabel === null ? "Balance unavailable" : balanceCaption)}
        </span>
      </span>
    </button>
  );
}

/**
 * The asset step, reached from the Deposit row.
 *
 * A screen rather than a segmented control because the choice carries a balance per option, and
 * that is the number the choice actually turns on.
 */

function AssetPickerScreen({
  balanceCaption,
  onBack,
  onSelect,
  options,
  selectedId,
  title,
}: {
  balanceCaption: string;
  onBack: () => void;
  onSelect: (id: string) => void;
  options: AssetOption[];
  selectedId: string;
  title: string;
}) {
  return (
    <>
      <PickerHeader onBack={onBack} title={title} />
      <div className="mt-2">
        {options.map((option) => (
          <AssetRow
            balanceCaption={balanceCaption}
            balanceLabel={option.balanceLabel}
            disabledReason={option.disabledReason}
            iconSrc={option.iconSrc}
            isSelected={option.id === selectedId}
            key={option.id}
            label={option.label}
            onSelect={() => onSelect(option.id)}
          />
        ))}
      </div>
    </>
  );
}

/** The blue disc every funding source on the Transfer from screen wears. */
function SourceBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-source-badge text-source-badge-fg">
      {children}
    </span>
  );
}

/**
 * Fiat funding, via Privy's on-ramp.
 *
 * It tops up the connected wallet rather than the trading account, so it is a source of funds and
 * not a one-tap deposit: money lands in the wallet, and the deposit above then moves it to the
 * venue. Whether any method is actually offered depends on the funding methods enabled for this
 * Privy app — the venue's own Busha/Coinbase ramp is not built.
 */
function BankAccountRow({ onSelect }: { onSelect: () => void }) {
  return (
    <button
      className="flex w-full cursor-pointer items-center gap-3 rounded-[14px] px-2 py-3 text-left transition-colors hover:bg-input-hover"
      onClick={onSelect}
      type="button"
    >
      <SourceBadge>
        <Landmark className="size-4" />
      </SourceBadge>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-[14px] text-panel-text-active">
          Bank account
        </span>
        <span className="block text-[12px] text-panel-text-muted">
          Add USDC with a bank transfer or card
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-panel-text-muted" />
    </button>
  );
}

/** One connected wallet the deposit could be paid from. */
function WalletRow({
  balanceLabel,
  isSelected,
  onSelect,
  wallet,
}: {
  /** Only the wallet currently funding the deposit has a balance read for it. */
  balanceLabel: string | null;
  isSelected: boolean;
  onSelect: () => void;
  wallet: ConnectedWallet;
}) {
  return (
    <button
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-[14px] px-2 py-3 text-left transition-colors hover:bg-input-hover",
        isSelected && "bg-input-bg"
      )}
      onClick={onSelect}
      type="button"
    >
      <SourceBadge>
        <Wallet className="size-4" />
      </SourceBadge>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-[14px] text-panel-text-active">
          {getWalletLabel(wallet)}
        </span>
        <span className="block text-[12px] text-panel-text-muted">
          {formatAddressShort(wallet.address)}
        </span>
      </span>
      {isSelected && balanceLabel !== null ? (
        <span className="shrink-0 text-right">
          <span className="block font-semibold text-[14px] text-panel-text-active">
            {balanceLabel}
          </span>
          <span className="block text-[12px] text-panel-text-muted">Available</span>
        </span>
      ) : null}
    </button>
  );
}

/**
 * The funding-source step, reached from the Transfer from row.
 *
 * Connected wallets are the only real sources here — this app has no fiat rail — so the list is
 * whatever Privy has connected, and the footer offers to connect one more.
 */
function WalletPickerScreen({
  balanceLabel,
  onBack,
  onConnectWallet,
  onFundWithBank,
  onSelect,
  selectedAddress,
  title,
  wallets,
}: {
  /** Null on the withdraw side, where a destination wallet's own balance says nothing useful. */
  balanceLabel: string | null;
  onBack: () => void;
  onConnectWallet?: () => void;
  /** Null when the connected wallet cannot run an on-ramp, and on the withdraw side. */
  onFundWithBank: (() => void) | null;
  onSelect: (wallet: ConnectedWallet) => void;
  selectedAddress: string;
  title: string;
  wallets: ConnectedWallet[];
}) {
  return (
    <>
      <PickerHeader onBack={onBack} title={title} />
      <div className="mt-2">
        {wallets.map((wallet) => (
          <WalletRow
            balanceLabel={balanceLabel}
            isSelected={wallet.address.toLowerCase() === selectedAddress.toLowerCase()}
            key={wallet.address}
            onSelect={() => onSelect(wallet)}
            wallet={wallet}
          />
        ))}
        {onFundWithBank === null ? null : <BankAccountRow onSelect={onFundWithBank} />}
      </div>
      {onConnectWallet === undefined ? null : (
        <button
          className={cn(SECONDARY_BUTTON_CLASSES, "mt-3 w-full")}
          onClick={onConnectWallet}
          type="button"
        >
          Connect another wallet
        </button>
      )}
    </>
  );
}

/** The drill-downs reachable from the amount step, each replacing the whole popup body. */
export type DepositScreen = "asset" | "form" | "wallet";

/** Which side of the toggle is showing. Withdrawals have no flow behind them yet. */
export type TransferMode = "deposit" | "withdraw";

const MODE_PILL_CLASSES = "min-h-8 rounded-full px-4 font-semibold text-[14px] transition-colors";

const ACTIVE_MODE_PILL_CLASSES = cn(MODE_PILL_CLASSES, "bg-foreground text-background");

/**
 * Deposit / Withdraw switch.
 *
 * Hidden once a deposit is in flight: switching away mid-approval would bury a pending on-chain
 * step behind a tab, and the step is the one thing the trader still has to act on.
 */
function ModeTabs({
  mode,
  onSelect,
}: {
  mode: TransferMode;
  onSelect: (mode: TransferMode) => void;
}) {
  return (
    <div className="inline-flex gap-1 rounded-full bg-input-bg p-1">
      <button
        aria-pressed={mode === "deposit"}
        className={cn(
          MODE_PILL_CLASSES,
          "cursor-pointer",
          mode === "deposit"
            ? "bg-foreground text-background"
            : "text-panel-text-muted hover:text-panel-text"
        )}
        onClick={() => onSelect("deposit")}
        type="button"
      >
        Deposit
      </button>
      <button
        aria-pressed={mode === "withdraw"}
        className={cn(
          MODE_PILL_CLASSES,
          "cursor-pointer",
          mode === "withdraw"
            ? "bg-foreground text-background"
            : "text-panel-text-muted hover:text-panel-text"
        )}
        onClick={() => onSelect("withdraw")}
        type="button"
      >
        Withdraw
      </button>
    </div>
  );
}

function getWithdrawStepCopy(flowState: WithdrawFlowState, currency: string) {
  switch (flowState.status) {
    case "checking":
      return `Checking your ${currency} balance and that the escrow can pay it out...`;
    case "signing":
      return "Confirm the withdrawal in your wallet.";
    case "confirming":
      return "Waiting for the withdrawal to confirm...";
    default:
      return null;
  }
}

/** What the withdrawal is doing, and the way back out of a stopped one. */
function WithdrawProgress({
  currency,
  fallback,
  flowState,
  reset,
}: {
  currency: string;
  /** The other escrow of this ticker, when the chosen one turned out not to pay. */
  fallback: { balanceLabel: string | null; label: string; onSelect: () => void } | null;
  flowState: WithdrawFlowState;
  reset: () => void;
}) {
  const isBusy = flowState.status === "checking" || flowState.status === "confirming";
  const stepCopy = getWithdrawStepCopy(flowState, currency);

  return (
    <div className="mt-6 space-y-4">
      {stepCopy === null ? null : (
        <p className={cn("text-[12px] text-panel-text", isBusy && "animate-pulse")}>{stepCopy}</p>
      )}

      {flowState.status === "blocked" ? (
        <p className="wrap-break-word text-[12px] text-ask-text">{flowState.reason}</p>
      ) : null}

      {flowState.status === "failed" ? (
        <p className="wrap-break-word text-[12px] text-ask-text">{flowState.error}</p>
      ) : null}

      {flowState.status === "success" ? (
        <p className="text-[12px] text-panel-text-active">
          Withdrawal confirmed. The {currency} is in your wallet.
        </p>
      ) : null}

      {/*
       * The way out of a short escrow: the same money in the other one. Worth surfacing here
       * because the balance is real but sits behind a row the trader has no reason to open.
       */}
      {flowState.status === "blocked" && fallback !== null ? (
        <p className="text-[12px] text-panel-text">
          {fallback.label} holds {fallback.balanceLabel ?? "a balance"} in this account.
        </p>
      ) : null}

      {/* The shared button classes size with flex-1, so every one of these needs a flex parent. */}
      {flowState.status === "blocked" || flowState.status === "failed" ? (
        <div className="flex gap-2">
          <button className={SECONDARY_BUTTON_CLASSES} onClick={reset} type="button">
            Back
          </button>
          {flowState.status === "blocked" && fallback !== null ? (
            <button className={PRIMARY_BUTTON_CLASSES} onClick={fallback.onSelect} type="button">
              Try {fallback.label}
            </button>
          ) : null}
        </div>
      ) : null}

      {flowState.status === "success" ? (
        <div className="flex gap-2">
          <button className={SECONDARY_BUTTON_CLASSES} onClick={reset} type="button">
            Withdraw more
          </button>
          <Dialog.Close className={PRIMARY_BUTTON_CLASSES}>Done</Dialog.Close>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The withdraw side.
 *
 * Laid out exactly like a deposit — same hero amount, same two-row route — and it pays out through
 * the same escrow a deposit pays into.
 */
function WithdrawSide({
  account,
  amount,
  asset,
  balanceLabel,
  fallback,
  flowState,
  inputError,
  onAmountChange,
  onConnectWallet,
  onMax,
  onPickAsset,
  onPickDestination,
  onWithdraw,
  reset,
}: {
  account: DepositAccount | null;
  amount: string;
  asset: WithdrawableAsset;
  balanceLabel: string | null;
  fallback: { balanceLabel: string | null; label: string; onSelect: () => void } | null;
  flowState: WithdrawFlowState | null;
  inputError: string | null;
  onAmountChange: (amount: string) => void;
  onConnectWallet?: () => void;
  onMax: (() => void) | null;
  onPickAsset: () => void;
  onPickDestination: (() => void) | null;
  onWithdraw: (account: DepositAccount) => void;
  reset: () => void;
}) {
  if (account === null) {
    return <ConnectWalletStep onConnectWallet={onConnectWallet} />;
  }

  return (
    <>
      <AmountField
        amount={amount}
        currency={asset.symbol}
        label="Withdraw"
        onAmountChange={flowState === null ? onAmountChange : undefined}
      />
      {inputError === null ? null : <p className="mt-2 text-[12px] text-ask-text">{inputError}</p>}
      <WithdrawRoute
        account={account}
        asset={asset}
        balanceLabel={balanceLabel}
        onMax={flowState === null ? onMax : null}
        onPickAsset={flowState === null ? onPickAsset : undefined}
        onPickDestination={flowState === null ? (onPickDestination ?? undefined) : undefined}
      />
      {flowState === null ? (
        <button
          className={cn(PRIMARY_BUTTON_CLASSES, "mt-6 w-full")}
          onClick={() => onWithdraw(account)}
          type="button"
        >
          Review withdrawal
        </button>
      ) : (
        <WithdrawProgress
          currency={asset.symbol}
          fallback={fallback}
          flowState={flowState}
          reset={reset}
        />
      )}
    </>
  );
}

function DepositProgress({
  approve,
  currency,
  deposit,
  onDepositAnother,
  reset,
  retry,
  flowState,
}: {
  approve: () => Promise<void>;
  currency: DepositCurrency;
  deposit: () => Promise<void>;
  flowState: DepositFlowState;
  /** Returns to the amount step for the other asset, so funding both is one visit. */
  onDepositAnother: (() => void) | null;
  reset: () => void;
  retry: () => void;
}) {
  const isBusy =
    flowState.status === "preflight" ||
    flowState.status === "approving" ||
    flowState.status === "depositing";
  const stepCopy = getStepCopy(flowState, currency);

  return (
    <div className="mt-6 space-y-4">
      {stepCopy !== null ? (
        <p className={cn("text-[12px] text-panel-text", isBusy && "animate-pulse")}>{stepCopy}</p>
      ) : null}

      {flowState.status === "blocked" ? (
        <p className="text-[12px] text-ask-text">
          {getBlockedCopy(flowState.reason, flowState.context.path === "create-and-deposit")}
        </p>
      ) : null}

      {flowState.status === "failed" ? (
        <p className="wrap-break-word text-[12px] text-ask-text">{flowState.error}</p>
      ) : null}

      {flowState.status === "success" ? (
        <p className="text-[12px] text-panel-text-active">
          Deposit confirmed to trading account #{flowState.subaccountId}.
        </p>
      ) : null}

      <div className="flex gap-2">
        {flowState.status === "awaiting-approval" ? (
          <button className={PRIMARY_BUTTON_CLASSES} onClick={() => void approve()} type="button">
            Approve {currency}
          </button>
        ) : null}

        {flowState.status === "awaiting-deposit" ? (
          <button className={PRIMARY_BUTTON_CLASSES} onClick={() => void deposit()} type="button">
            Confirm deposit
          </button>
        ) : null}

        {flowState.status === "failed" ? (
          <button className={PRIMARY_BUTTON_CLASSES} onClick={retry} type="button">
            Retry
          </button>
        ) : null}

        {flowState.status === "blocked" || flowState.status === "failed" ? (
          <button className={SECONDARY_BUTTON_CLASSES} onClick={reset} type="button">
            Back
          </button>
        ) : null}

        {flowState.status === "success" && onDepositAnother !== null ? (
          <button className={PRIMARY_BUTTON_CLASSES} onClick={onDepositAnother} type="button">
            Deposit another asset
          </button>
        ) : null}

        {flowState.status === "success" ? (
          <Dialog.Close
            className={
              onDepositAnother === null ? PRIMARY_BUTTON_CLASSES : SECONDARY_BUTTON_CLASSES
            }
          >
            Done
          </Dialog.Close>
        ) : null}
      </div>
    </div>
  );
}

/** The in-flight step: the amount and route stay on screen above the approval/deposit prompts. */
function DepositFlowStep({
  account,
  amount,
  approve,
  balanceLabel,
  currency,
  deposit,
  flowState,
  onDepositAnother,
  reset,
  retry,
}: {
  account: DepositAccount;
  amount: string;
  approve: () => Promise<void>;
  balanceLabel: string | null;
  currency: DepositCurrency;
  deposit: () => Promise<void>;
  flowState: DepositFlowState;
  onDepositAnother: (() => void) | null;
  reset: () => void;
  retry: () => void;
}) {
  return (
    <>
      <AmountField amount={amount} currency={currency} />
      <TransferRoute account={account} balanceLabel={balanceLabel} currency={currency} />
      <DepositProgress
        approve={approve}
        currency={currency}
        deposit={deposit}
        flowState={flowState}
        onDepositAnother={onDepositAnother}
        reset={reset}
        retry={retry}
      />
    </>
  );
}

/**
 * Everything behind the Deposit tab: the login prompt, the amount step, and the in-flight steps.
 *
 * Branching lives here rather than in the dialog shell so the shell only has to decide which side
 * of the toggle is showing.
 */
function DepositSide({
  account,
  amount,
  approve,
  balanceLabel,
  currency,
  deposit,
  flowState,
  inputError,
  onAmountChange,
  onConnectWallet,
  onDepositAnother,
  onMax,
  onPickAsset,
  onPickWallet,
  onReview,
  pauseReason,
  reset,
  retry,
}: {
  account: DepositAccount | null;
  amount: string;
  approve: () => Promise<void>;
  balanceLabel: string | null;
  currency: DepositCurrency;
  deposit: () => Promise<void>;
  flowState: DepositFlowState | null;
  inputError: string | null;
  onAmountChange: (amount: string) => void;
  onConnectWallet?: () => void;
  onDepositAnother: (() => void) | null;
  onMax: (() => void) | null;
  onPickAsset: () => void;
  onPickWallet: (() => void) | null;
  onReview: (account: DepositAccount) => void;
  pauseReason: string | null;
  reset: () => void;
  retry: () => void;
}) {
  if (account === null) {
    return <ConnectWalletStep onConnectWallet={onConnectWallet} />;
  }

  if (flowState === null) {
    return (
      <DepositForm
        account={account}
        amount={amount}
        balanceLabel={balanceLabel}
        currency={currency}
        inputError={inputError}
        onAmountChange={onAmountChange}
        onMax={onMax}
        onPickAsset={onPickAsset}
        onPickWallet={onPickWallet}
        onSubmit={() => onReview(account)}
        pauseReason={pauseReason}
      />
    );
  }

  return (
    <DepositFlowStep
      account={account}
      amount={amount}
      approve={approve}
      balanceLabel={balanceLabel}
      currency={currency}
      deposit={deposit}
      flowState={flowState}
      onDepositAnother={onDepositAnother}
      reset={reset}
      retry={retry}
    />
  );
}

/** Picks the side of the toggle to render, so the dialog shell does not have to. */
function TransferSide({
  account,
  amount,
  approve,
  balanceLabel,
  currency,
  deposit,
  flowState,
  inputError,
  mode,
  onAmountChange,
  onConnectWallet,
  onDepositAnother,
  onMax,
  onPickAsset,
  onPickWallet,
  onReview,
  onWithdraw,
  pauseReason,
  reset,
  resetWithdraw,
  retry,
  withdrawAsset,
  withdrawFallback,
  withdrawFlowState,
}: {
  account: DepositAccount | null;
  amount: string;
  approve: () => Promise<void>;
  balanceLabel: string | null;
  currency: DepositCurrency;
  deposit: () => Promise<void>;
  flowState: DepositFlowState | null;
  inputError: string | null;
  mode: TransferMode;
  onAmountChange: (amount: string) => void;
  onConnectWallet?: () => void;
  onDepositAnother: (() => void) | null;
  onMax: (() => void) | null;
  onPickAsset: () => void;
  onPickWallet: (() => void) | null;
  onReview: (account: DepositAccount) => void;
  onWithdraw: (account: DepositAccount) => void;
  pauseReason: string | null;
  reset: () => void;
  resetWithdraw: () => void;
  retry: () => void;
  withdrawAsset: WithdrawableAsset;
  withdrawFallback: { balanceLabel: string | null; label: string; onSelect: () => void } | null;
  withdrawFlowState: WithdrawFlowState | null;
}) {
  if (mode === "withdraw") {
    return (
      <WithdrawSide
        account={account}
        amount={amount}
        asset={withdrawAsset}
        balanceLabel={balanceLabel}
        fallback={withdrawFallback}
        flowState={withdrawFlowState}
        inputError={inputError}
        onAmountChange={onAmountChange}
        onConnectWallet={onConnectWallet}
        onMax={onMax}
        onPickAsset={onPickAsset}
        onPickDestination={onPickWallet}
        onWithdraw={onWithdraw}
        reset={resetWithdraw}
      />
    );
  }

  return (
    <DepositSide
      account={account}
      amount={amount}
      approve={approve}
      balanceLabel={balanceLabel}
      currency={currency}
      deposit={deposit}
      flowState={flowState}
      inputError={inputError}
      onAmountChange={onAmountChange}
      onConnectWallet={onConnectWallet}
      onDepositAnother={onDepositAnother}
      onMax={onMax}
      onPickAsset={onPickAsset}
      onPickWallet={onPickWallet}
      onReview={onReview}
      pauseReason={pauseReason}
      reset={reset}
      retry={retry}
    />
  );
}

/** Renders whichever drill-down is open, or nothing on the amount step. */
function DepositPicker({
  account,
  balanceLabel,
  assetOptions,
  fundingWallets,
  onBack,
  onConnectWallet,
  onFundWithBank,
  onSelectAsset,
  onSelectWallet,
  screen,
  selectedAssetId,
  titles,
}: {
  account: DepositAccount | null;
  balanceLabel: string | null;
  assetOptions: AssetOption[];
  fundingWallets: ConnectedWallet[];
  onBack: () => void;
  onConnectWallet?: () => void;
  onFundWithBank: (() => void) | null;
  onSelectAsset: (id: string) => void;
  selectedAssetId: string;
  onSelectWallet: (wallet: ConnectedWallet) => void;
  screen: DepositScreen;
  /** "Deposit to" / "Transfer from" on the deposit side, their opposites on the withdraw side. */
  titles: { asset: string; balanceCaption: string; wallet: string };
}) {
  if (screen === "asset") {
    return (
      <AssetPickerScreen
        balanceCaption={titles.balanceCaption}
        onBack={onBack}
        onSelect={onSelectAsset}
        options={assetOptions}
        selectedId={selectedAssetId}
        title={titles.asset}
      />
    );
  }

  if (screen === "wallet" && account !== null) {
    return (
      <WalletPickerScreen
        balanceLabel={balanceLabel}
        onBack={onBack}
        onConnectWallet={onConnectWallet}
        onFundWithBank={onFundWithBank}
        onSelect={onSelectWallet}
        selectedAddress={account.wallet.address}
        title={titles.wallet}
        wallets={fundingWallets}
      />
    );
  }

  return null;
}

export function DepositDialog({
  account,
  accountRows,
  currency: controlledCurrency,
  fundingWallets,
  onConnectWallet,
  onCurrencyChange,
  onDeposited,
  onWithdrawn,
  onOpenChange,
  open,
  triggerClassName,
  onSelectFundingWallet,
  triggerId,
  walletBalances,
}: {
  /** The funding wallet and its trading account, or null when no wallet is connected. */
  account: DepositAccount | null;
  /**
   * Controlled asset selection; omit to let the dialog own it. Pass with `onCurrencyChange` when
   * something outside the dialog decides which asset to fund — the order ticket's shortfall CTA
   * names the leg the account is short of, and the form has to open on that one.
   */
  currency?: DepositCurrency;
  /** Starts wallet login from the dialog's no-wallet step. */
  onConnectWallet?: () => void;
  /** Fires for both the asset picker and the "deposit the other asset" step. */
  onCurrencyChange?: (currency: DepositCurrency) => void;
  onDeposited: (subaccountId: string) => void;
  /** Fires after a confirmed withdrawal, so balances upstream can be re-read. */
  onWithdrawn?: () => void;
  /** Pass with `open` to drive the dialog from outside, e.g. the order ticket's Deposit CTA. */
  onOpenChange?: (open: boolean) => void;
  /** Controlled open state; omit to let the dialog own it from its own trigger. */
  open?: boolean;
  /**
   * Every wallet Privy has connected — the funding sources the Transfer from screen lists. Without
   * `onSelectFundingWallet` the screen is read-only, and without either the row does not open.
   */
  fundingWallets?: ConnectedWallet[];
  /** Switches which connected wallet pays for the deposit. */
  onSelectFundingWallet?: (wallet: ConnectedWallet) => void;
  /** Overrides the default inline pill trigger styling, e.g. for the global header toolbar. */
  triggerClassName?: string;
  /** Stable DOM id for the trigger so SSR and client markup agree even if hydration re-renders. */
  triggerId?: string;
  /**
   * Wallet-held balances, used for the balance readout and Max. Omitted currencies simply lose
   * both — the dialog never guesses a spendable amount it has not been handed.
   */
  walletBalances?: DepositWalletBalances;
  /**
   * The account's on-ledger rows, one per asset it holds. The withdraw side reads these rather
   * than a currency map, because an account can hold a balance in more than one escrow per
   * ticker — mainnet has two USDC escrows, and only one of them is the cash the engine settles in.
   */
  accountRows?: { asset: string; balance: bigint }[] | null;
}) {
  const dialog = useTransferDialog({
    account,
    accountRows,
    controlledCurrency,
    fundingWallets,
    onCurrencyChange,
    onDeposited,
    onOpenChange,
    onSelectFundingWallet,
    onWithdrawn,
    open,
    walletBalances,
  });

  return (
    <Dialog.Root onOpenChange={dialog.handleOpenChange} open={dialog.isOpen}>
      {/*
       * Not gated on a connected wallet: the dialog's first step is the login prompt, so a
       * disconnected visitor clicking Deposit gets somewhere to go instead of a dead button.
       */}
      <Dialog.Trigger
        className={
          triggerClassName ??
          "rounded-lg bg-input-bg px-2 py-0.5 font-semibold text-[11px] text-panel-text-active ring-1 ring-panel-border transition-colors hover:bg-input-hover"
        }
        id={triggerId}
      >
        Deposit
      </Dialog.Trigger>
      <Dialog.Portal>
        {/*
         * Explicit z-index: the terminal panels create stacking contexts that otherwise paint
         * over the popup — order book rows were rendering on top of this dialog's own controls.
         */}
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-1/2 fixed top-1/2 left-1/2 z-50 w-[min(92vw,420px)] rounded-[24px] bg-dialog-bg p-6 text-foreground shadow-[0_28px_90px_var(--panel-shadow)] ring-1 ring-panel-ring transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <DepositPicker
            account={account}
            assetOptions={dialog.assetOptions}
            balanceLabel={dialog.isDepositMode ? dialog.balanceView.label : null}
            fundingWallets={dialog.connectedWallets}
            onBack={dialog.returnToForm}
            onConnectWallet={onConnectWallet}
            onFundWithBank={
              dialog.isDepositMode && dialog.canFundWithBank ? dialog.handleFundWithBank : null
            }
            onSelectAsset={dialog.handlePickAsset}
            onSelectWallet={dialog.handlePickWallet}
            screen={dialog.screen}
            selectedAssetId={dialog.selectedAssetId}
            titles={getPickerTitles(dialog.mode)}
          />

          <div
            className={cn("flex items-start justify-between gap-3", dialog.isOnPicker && "hidden")}
          >
            {/* The visible switch is a pair of buttons, which cannot live inside the heading. */}
            <Dialog.Title className="sr-only">
              {dialog.isDepositMode ? "Deposit" : "Withdraw"}
            </Dialog.Title>
            {dialog.depositFlowState === null ? (
              <ModeTabs mode={dialog.mode} onSelect={dialog.handleSelectMode} />
            ) : (
              <span className={ACTIVE_MODE_PILL_CLASSES}>Deposit</span>
            )}
            <Dialog.Close
              aria-label="Close deposit dialog"
              className="-mt-0.5 -mr-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {dialog.isOnPicker ? null : (
            <TransferSide
              account={account}
              amount={dialog.amount}
              approve={dialog.approve}
              balanceLabel={dialog.balanceView.label}
              currency={dialog.currency}
              deposit={dialog.deposit}
              flowState={dialog.depositFlowState}
              inputError={dialog.inputError}
              mode={dialog.mode}
              onAmountChange={dialog.handleAmountChange}
              onConnectWallet={onConnectWallet}
              onDepositAnother={dialog.depositAnother}
              onMax={dialog.setMaxAmount}
              onPickAsset={dialog.openAssetPicker}
              onPickWallet={dialog.openWalletPicker}
              onReview={dialog.handleReviewDeposit}
              onWithdraw={dialog.handleWithdraw}
              pauseReason={dialog.depositPauseReason}
              reset={dialog.reset}
              resetWithdraw={dialog.resetWithdraw}
              retry={dialog.retry}
              withdrawAsset={dialog.withdrawAsset}
              withdrawFallback={dialog.withdrawFallback}
              withdrawFlowState={dialog.withdrawFlowState}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
