"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { CandleInterval } from "@/lib/markets-service";
import type { SpotMarket } from "@/lib/trading.types";
import { SpotTradingTerminal } from "@/ui/trading-terminal/SpotTradingTerminal";

/** The account before any fixture deposit: funded, with resting orders claiming part of it. */
const OPENING_BALANCES = { cngn: 41_470.685_234, usdc: 31.028_472_772_594_67 };

/**
 * What this trader's own resting orders claim. Expressed as orders rather than as a number, because
 * the terminal derives the spendable balance from the book the way the venue serves it.
 */
const CLAIMED = { cngn: 12_224, usdc: 8.927_931 };
/** USDC per cNGN, about ₦1,400 per USDC. */
const FIXTURE_PRICE = 1 / 1400;
/**
 * The trader's own orders rest outside the band a market order is signed through (the touch
 * plus the slippage allowance). Resting at the mid, or at the touch, they crossed the ticket's
 * own order and its own-crossing guard disabled the CTA before the check could type an amount.
 */
const OWN_BUY_PRICE = 1 / 1410;
const OWN_SELL_PRICE = 1 / 1390;
const FIXTURE_WALLET = "0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";

const FIXTURE_BUTTON_CLASSES =
  "flex h-10 cursor-pointer items-center whitespace-nowrap rounded-sm bg-input-bg px-4 font-semibold text-[14px] text-panel-text ring-1 ring-panel-border";

/** The fill "Inject trade" streams in: 7,010 cNGN (about 5 USDC) at ₦1,402 per USDC, a buy of cNGN. */
const INJECTED_TRADE = { price: 1 / 1402, size: 5 * 1402 };

/** What one fixture deposit adds. Large enough to clear any shortfall the check types in. */
const DEPOSIT_AMOUNT = { cngn: 500_000, usdc: 500 };

/**
 * A book with depth on both sides, so the ticket has a touch to price against and the balances can
 * actually fall short of an order. The numbers are the shape `cNGN-USDC` trades at, not a claim
 * about any particular session.
 */
const FIXTURE_MARKET: SpotMarket = {
  candles: [],
  mark: FIXTURE_PRICE,
  orderEntrySpec: "cngn_usdc_spot_v1",
  orderStack: null,
  stats24h: null,
  takerFeeBps: 25,
  // One order per leg, so both header balances carry a claim and both disclosures are on screen.
  openOrders: [
    {
      expiresAtMs: null,
      filled: 0,
      nonce: "1",
      orderId: "fixture:buy",
      ownerAddress: FIXTURE_WALLET,
      price: OWN_BUY_PRICE,
      side: "buy",
      size: CLAIMED.usdc / OWN_BUY_PRICE,
    },
    {
      expiresAtMs: null,
      filled: 0,
      nonce: "2",
      orderId: "fixture:sell",
      ownerAddress: FIXTURE_WALLET,
      price: OWN_SELL_PRICE,
      side: "sell",
      size: CLAIMED.cngn,
    },
  ],
  orderBookAsks: [
    { price: 1 / 1399, size: 16_800, total: 16_800 },
    { price: 1 / 1397, size: 28_000, total: 44_800 },
  ],
  orderBookBids: [
    { price: 1 / 1401, size: 19_600, total: 19_600 },
    { price: 1 / 1403, size: 35_000, total: 54_600 },
  ],
  // Timestamped an hour back, so a fill injected now reads as newer than what the server knew.
  trades: [
    {
      atMs: Date.now() - 3_600_000,
      id: 1,
      price: FIXTURE_PRICE,
      side: "buy",
      size: 4200,
      time: "12:00:00",
    },
  ],
};

/**
 * The terminal in a connected, funded state, which the app itself can only reach with a real wallet
 * and a real subaccount.
 *
 * `scripts/check-layout.mjs` drives this to pin the two things the signed-out page cannot show: the
 * header carrying both balances on a phone, and a completed deposit clearing a shortfall without
 * the trader re-entering their order. The deposit button stands in for `handleDeposited`, which
 * likewise only raises the balances the terminal is rendered with — the ticket is never unmounted,
 * so whatever was typed into it has to survive.
 *
 * Dev-only: the route that renders this 404s in production.
 */
const CANDLE_INTERVALS = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
] as const satisfies readonly CandleInterval[];

function isCandleInterval(value: string | null): value is CandleInterval {
  return CANDLE_INTERVALS.some((interval) => interval === value);
}

export function LayoutFixtureTerminal() {
  const [deposits, setDeposits] = useState(0);
  // `?interval=1m` folds injected fills at that interval, to check candles extend within a bucket
  // and a new one opens at the boundary; the app itself serves daily candles.
  const requestedInterval = useSearchParams().get("interval");
  const candleInterval: CandleInterval = isCandleInterval(requestedInterval)
    ? requestedInterval
    : "1d";
  const accountCngn = OPENING_BALANCES.cngn + deposits * DEPOSIT_AMOUNT.cngn;
  const accountUsdc = OPENING_BALANCES.usdc + deposits * DEPOSIT_AMOUNT.usdc;

  return (
    <main className="flex min-h-screen flex-col bg-terminal-bg text-foreground md:h-dvh md:overflow-hidden">
      <SpotTradingTerminal
        accountCngn={accountCngn}
        accountUsdc={accountUsdc}
        candleInterval={candleInterval}
        candles={[]}
        depositControl={
          <div className="flex items-center gap-2">
            <button
              className={FIXTURE_BUTTON_CLASSES}
              id="fixture-deposit"
              onClick={() => setDeposits((count) => count + 1)}
              type="button"
            >
              Deposit
            </button>
            {/*
             * Pushes a fill by another account through the stream path, in the engine's units
             * (USDC per cNGN, cNGN amount) exactly as markets-service would frame it, to check that
             * the chart's candle and the 24h volume follow a trade without a reload.
             */}
            <button
              className={FIXTURE_BUTTON_CLASSES}
              id="fixture-inject-trade"
              onClick={() =>
                window.__numoInjectFrame?.({
                  channel: "trades",
                  type: "update",
                  data: {
                    aggressor_side: "buy",
                    created_at: new Date().toISOString(),
                    price: INJECTED_TRADE.price.toFixed(10),
                    size: String(INJECTED_TRADE.size),
                    trade_id: Date.now(),
                    tx_hash: `0x${"ab".repeat(32)}`,
                  },
                })
              }
              type="button"
            >
              Inject trade
            </button>
          </div>
        }
        hasWallet
        isSignedIn
        onCancelOrder={() => Promise.resolve({ ok: true })}
        onSubmitOrder={() => undefined}
        spotMarket={FIXTURE_MARKET}
        walletAddress={FIXTURE_WALLET}
      />
    </main>
  );
}
