"use client";

import { useState } from "react";
import type { SpotMarket } from "@/lib/trading.types";
import { SpotTradingTerminal } from "@/ui/trading-terminal/SpotTradingTerminal";

/** The account before any fixture deposit: funded, with resting orders claiming part of it. */
const OPENING_BALANCES = { cngn: 41_470.685_234, usdc: 31.028_472_772_594_67 };

/**
 * What this trader's own resting orders claim. Expressed as orders rather than as a number, because
 * the terminal derives the spendable balance from the book the way the venue serves it.
 */
const CLAIMED = { cngn: 12_224, usdc: 8.927_931 };
const FIXTURE_PRICE = 1400;
const FIXTURE_WALLET = "0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";

/** What one fixture deposit adds. Large enough to clear any shortfall the check types in. */
const DEPOSIT_AMOUNT = { cngn: 500_000, usdc: 500 };

/**
 * A book with depth on both sides, so the ticket has a touch to price against and the balances can
 * actually fall short of an order. The numbers are the shape `USDCcNGN-SPOT` trades at, not a claim
 * about any particular session.
 */
const FIXTURE_MARKET: SpotMarket = {
  candles: [],
  mark: FIXTURE_PRICE,
  orderEntrySpec: "usdc_cngn_spot_v1",
  trades: [{ price: FIXTURE_PRICE, side: "buy", size: 3, time: "12:00:00" }],
  // One order per leg, so both header balances carry a claim and both disclosures are on screen.
  openOrders: [
    {
      expiresAtMs: null,
      filled: 0,
      nonce: "1",
      orderId: "fixture:buy",
      ownerAddress: FIXTURE_WALLET,
      price: FIXTURE_PRICE,
      side: "buy",
      size: CLAIMED.cngn / FIXTURE_PRICE,
    },
    {
      expiresAtMs: null,
      filled: 0,
      nonce: "2",
      orderId: "fixture:sell",
      ownerAddress: FIXTURE_WALLET,
      price: FIXTURE_PRICE,
      side: "sell",
      size: CLAIMED.usdc,
    },
  ],
  orderBookAsks: [
    { price: 1401, size: 12, total: 12 },
    { price: 1403, size: 20, total: 32 },
  ],
  orderBookBids: [
    { price: 1399, size: 14, total: 14 },
    { price: 1397, size: 25, total: 39 },
  ],
};

function tickerLabel(value: number, symbol: string) {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${symbol}`;
}

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
export function LayoutFixtureTerminal() {
  const [deposits, setDeposits] = useState(0);
  const accountCngn = OPENING_BALANCES.cngn + deposits * DEPOSIT_AMOUNT.cngn;
  const accountUsdc = OPENING_BALANCES.usdc + deposits * DEPOSIT_AMOUNT.usdc;

  return (
    <main className="flex min-h-screen flex-col bg-terminal-bg text-foreground xl:h-dvh xl:overflow-hidden">
      <SpotTradingTerminal
        accountCngn={accountCngn}
        accountCngnLabel={tickerLabel(accountCngn, "cNGN")}
        accountUsdc={accountUsdc}
        accountUsdcLabel={tickerLabel(accountUsdc, "USDC")}
        candles={[]}
        cngnBalanceLabel="0 cNGN"
        depositControl={
          <button
            className="flex h-10 cursor-pointer items-center whitespace-nowrap rounded-full bg-input-bg px-4 font-semibold text-[12px] text-panel-text ring-1 ring-panel-border"
            id="fixture-deposit"
            onClick={() => setDeposits((count) => count + 1)}
            type="button"
          >
            Deposit
          </button>
        }
        hasWallet
        isSignedIn
        onSubmitOrder={() => undefined}
        spotMarket={FIXTURE_MARKET}
        usdcBalanceLabel="0 USDC"
        walletAddress={FIXTURE_WALLET}
      />
    </main>
  );
}
