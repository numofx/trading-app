import type {
  PerpFundingAccrual,
  PerpFundingLog,
  PerpFundingPayment,
} from "@/lib/perp-funding-history.types";
import { formatPerpRate, perpOrderUiSide, perpSideLabel } from "@/lib/perp-market";
import { sideTone } from "@/lib/side-tone";
import type { ActivityRow, ActivityView, CellTone } from "@/lib/trading.types";

const WAD = 10n ** 18n;
// Six decimals of cNGN survive the size division; a position is whole cNGN, so this is plenty.
const SIZE_SCALE = 10n ** 6n;

export const PERP_FUNDING_HISTORY_COLUMNS = [
  "Time",
  "Market",
  "Position",
  "Funding Rate",
  "Payment",
];

function wadToNumber(value: bigint) {
  return Number(value) / 1e18;
}

/**
 * Every non-zero funding the PerpAsset booked to `accountId`, newest first, from its
 * `FundingAppliedOnAccount` and `AggregatedFundingUpdated` events in chain order.
 *
 * The contract has no hourly payments: funding accrues continuously and is booked to an account
 * whenever that account is touched, as `-size × (aggregate − aggregate at the last touch)`. So the
 * size held over the stretch is recovered from the event pair itself, the time is the block's (the
 * update that precedes every booking stamps it), and the rate is the hourly one in force then.
 */
export function buildFundingPayments(
  logs: PerpFundingLog[],
  accountId: bigint
): PerpFundingPayment[] {
  const payments: PerpFundingPayment[] = [];
  let lastUpdate: { rate: bigint; timestamp: bigint } | null = null;
  let lastAggregate: bigint | null = null;

  for (const log of logs) {
    if (log.eventName === "AggregatedFundingUpdated") {
      lastUpdate = { rate: log.fundingRate, timestamp: log.lastFundingPaidAt };
      continue;
    }
    if (log.accountId !== accountId) {
      continue;
    }
    const delta = lastAggregate === null ? 0n : log.aggregatedFundingRate - lastAggregate;
    lastAggregate = log.aggregatedFundingRate;
    if (log.funding === 0n || delta === 0n || lastUpdate === null) {
      continue;
    }
    payments.push({
      payment: wadToNumber(log.funding),
      rate: wadToNumber(lastUpdate.rate),
      size: Number((-log.funding * SIZE_SCALE) / delta) / Number(SIZE_SCALE),
      timestamp: Number(lastUpdate.timestamp),
    });
  }
  return payments.reverse();
}

/**
 * Funding the open position has accrued since the account's last touch, at the live rate and
 * index, as the contract would book it now: `-size × (aggregate brought to now − last aggregate)`.
 */
export function estimateFundingAccrual(chain: {
  aggregatedFunding: bigint;
  lastFundingPaidAt: bigint;
  fundingRate: bigint;
  indexPrice: bigint;
  /** The account's `positions(accountId).lastAggregatedFunding`. */
  lastAggregatedFunding: bigint;
  /** Whole cNGN, signed: positive long. */
  size: bigint;
  nowSeconds: bigint;
}): PerpFundingAccrual | null {
  if (chain.size === 0n) {
    return null;
  }
  const elapsed =
    chain.nowSeconds > chain.lastFundingPaidAt ? chain.nowSeconds - chain.lastFundingPaidAt : 0n;
  const aggregateNow =
    chain.aggregatedFunding + (((chain.fundingRate * elapsed) / 3600n) * chain.indexPrice) / WAD;
  return {
    payment: wadToNumber(-chain.size * (aggregateNow - chain.lastAggregatedFunding)),
    rate: wadToNumber(chain.fundingRate),
    size: Number(chain.size),
  };
}

const SIZE_CELL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "10/09/26 08:00 PM": date and time formatted apart so no runtime's joiner sneaks in. */
function formatFundingTime(seconds: number, timeZone: string | undefined) {
  const date = new Date(seconds * 1000);
  const day = date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "2-digit",
  });
  const time = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    hour12: true,
    minute: "2-digit",
    timeZone,
  });
  return `${day} ${time}`;
}

/** "-$0.000848", "$1.62": funding is often fractions of a cent, so up to six decimals. */
function formatPayment(value: number) {
  if (value !== 0 && Math.abs(value) < 0.000_000_5) {
    return `${value < 0 ? "-" : ""}<$0.000001`;
  }
  const amount = Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: 2,
  });
  return `${value < 0 ? "-" : ""}$${amount}`;
}

function fundingRow(
  time: string,
  row: { size: number; rate: number; payment: number },
  label: string
): ActivityRow {
  const uiSide = row.size >= 0 ? "long" : "short";
  const side = sideTone(perpOrderUiSide(uiSide));
  const tones: Record<number, CellTone> = { 1: side };
  if (row.payment !== 0) {
    tones[4] = row.payment > 0 ? "positive" : "negative";
  }
  return {
    badges: { 1: [{ label: perpSideLabel(uiSide), tone: side }] },
    cells: [
      time,
      label,
      `${SIZE_CELL.format(Math.abs(row.size))} cNGN`,
      formatPerpRate(row.rate),
      formatPayment(row.payment),
    ],
    tones,
  };
}

/** The tab's view once the chain has been read, or null while it is still loading. */
export function fundingHistoryViewOf(
  state: {
    accrual: PerpFundingAccrual | null;
    payments: PerpFundingPayment[];
    status: "idle" | "loading" | "ready" | "error";
  },
  label: string
) {
  if (state.status === "idle" || state.status === "loading") {
    return null;
  }
  return buildFundingHistoryView(state.payments, state.accrual, label);
}

/**
 * The Funding History tab: what is accruing on the open position now, then every booked payment,
 * newest first.
 */
export function buildFundingHistoryView(
  payments: PerpFundingPayment[],
  accrual: PerpFundingAccrual | null,
  label: string,
  timeZone?: string
): ActivityView {
  const rows = payments.map((payment) =>
    fundingRow(formatFundingTime(payment.timestamp, timeZone), payment, label)
  );
  if (accrual !== null) {
    const accruing = fundingRow("Accruing", accrual, label);
    accruing.details = { 4: "est." };
    accruing.titles = {
      0: "Funding accrued since the account was last touched, booked at its next trade or settlement",
    };
    rows.unshift(accruing);
  }
  return { columns: PERP_FUNDING_HISTORY_COLUMNS, rows };
}
