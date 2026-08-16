import { expect, test } from "bun:test";
import {
  formatAccountCngn,
  formatAccountUsdc,
  formatBalance,
  formatBalanceFigure,
  getClaimedNote,
} from "./account-balance-display.ts";
import { collectOpenOrders, getCommittedBalances, getWorkingOrders } from "./spot-market.ts";

/**
 * Read off a live session against `api.numofx.com`: subaccount 10 holding ₦41,470.685234 and
 * 31.02847277259467116 USDC cash, with ten of its own orders resting on `USDCcNGN-SPOT`. The
 * committed figures are what `getCommittedBalances` returned for that book.
 */
const LIVE = {
  accountCngn: 41_470.685_234,
  accountUsdc: 31.028_472_772_594_67,
  committedCngn: 12_223.999_391_317_002,
  committedUsdc: 8.927_931_000_000_001,
};

test("the header, the note and the ticket reconcile on a real funded account", () => {
  const spendableCngn = LIVE.accountCngn - LIVE.committedCngn;
  const spendableUsdc = LIVE.accountUsdc - LIVE.committedUsdc;

  expect(formatAccountCngn(LIVE.accountCngn)).toBe("41,470.69 cNGN");
  expect(getClaimedNote(LIVE.accountCngn, spendableCngn, formatAccountCngn)).toBe("12,224 cNGN");
  expect(formatAccountCngn(spendableCngn)).toBe("29,246.69 cNGN");

  expect(formatAccountUsdc(LIVE.accountUsdc)).toBe("31.03 USDC");
  expect(getClaimedNote(LIVE.accountUsdc, spendableUsdc, formatAccountUsdc)).toBe("8.93 USDC");
  expect(formatAccountUsdc(spendableUsdc)).toBe("22.1 USDC");
});

test("nothing resting means nothing to explain", () => {
  expect(getClaimedNote(LIVE.accountCngn, LIVE.accountCngn, formatAccountCngn)).toBeNull();
  expect(getClaimedNote(LIVE.accountUsdc, LIVE.accountUsdc, formatAccountUsdc)).toBeNull();
});

test("an unknown balance carries no note rather than a zero one", () => {
  expect(getClaimedNote(null, 100, formatAccountCngn)).toBeNull();
  expect(getClaimedNote(100, null, formatAccountCngn)).toBeNull();
  expect(formatAccountCngn(null)).toBe("—");
  expect(formatAccountUsdc(null)).toBe("—");
});

/**
 * The case that killed the first rule, which compared the *spendable* figure against the balance:
 * abbreviated to one decimal, 2.14M and 2.1M cNGN print identically, so the note agreed with the
 * total while the ticket showed 40k less. Naming the claim keeps it visible.
 */
test("a claim smaller than the cNGN abbreviation's rounding still shows", () => {
  const balance = 2_140_000;
  const claimed = 40_000;

  expect(formatAccountCngn(balance)).toBe("2.1M cNGN");
  expect(formatAccountCngn(balance - claimed)).toBe("2.1M cNGN");
  expect(getClaimedNote(balance, balance - claimed, formatAccountCngn)).toBe("40,000 cNGN");
});

test("a claim below the printed precision is suppressed", () => {
  // Sub-kobo dust from the balance arithmetic is not a claim worth a line in the header.
  expect(getClaimedNote(2_140_000, 2_140_000 - 0.001, formatAccountCngn)).toBeNull();
  expect(getClaimedNote(31.03, 31.03 - 0.001, formatAccountUsdc)).toBeNull();
});

test("a claim larger than the balance cannot print a negative", () => {
  expect(getClaimedNote(100, -50, formatAccountUsdc)).toBe("150 USDC");
  expect(getClaimedNote(100, 200, formatAccountUsdc)).toBeNull();
});

/**
 * Two orders as `api.numofx.com` served them on `USDCcNGN-SPOT`, with the expiry pushed out so the
 * fixture does not age out of `getWorkingOrders`. The engine rests spot inverted, so the UI side
 * lives in `spot_contract.ui_intent` — a UI sell costs USDC, a UI buy costs size × price in cNGN.
 */
const MAKER = "0x3448ac0a3283951a2afd5b3a582329eca43cb47b";
const TRADER = "0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
const NOW_MS = 1_786_900_000_000;

function buildLiveBook({ bidOwner = MAKER, askOwner = MAKER } = {}) {
  return {
    market_presentation: { order_entry_spec: "usdc_cngn_spot_v1" },
    bids: [
      {
        desired_amount: "1652",
        expiry: NOW_MS / 1000 + 3600,
        filled_amount: "0",
        limit_price: "0.000726288850804633",
        nonce: "3573807811076965",
        order_id: "mm:USDCcNGN-SPOT:sell:3573807811076965",
        owner_address: bidOwner,
        side: "buy",
        spot_contract: { ui_intent: { price: "1376.862661", side: "sell", size: "1.199829" } },
      },
    ],
    asks: [
      {
        desired_amount: "1648",
        expiry: NOW_MS / 1000 + 3600,
        filled_amount: "0",
        limit_price: "0.000727793742925475",
        nonce: "3573807835091856",
        order_id: "mm:USDCcNGN-SPOT:buy:3573807835091856",
        owner_address: askOwner,
        side: "sell",
        spot_contract: { ui_intent: { price: "1374.01566", side: "buy", size: "1.199404" } },
      },
    ],
  };
}

function readHeader(book, walletAddress, balances) {
  const working = getWorkingOrders(collectOpenOrders(book), NOW_MS);
  const committed = getCommittedBalances(working, walletAddress);
  return {
    cngnNote: getClaimedNote(
      balances.cngn,
      Math.max(0, balances.cngn - committed.cngn),
      formatAccountCngn
    ),
    committed,
    usdcNote: getClaimedNote(
      balances.usdc,
      Math.max(0, balances.usdc - committed.usdc),
      formatAccountUsdc
    ),
  };
}

/**
 * The ownership scoping, end to end from the venue's own payload: the same book says "nothing of
 * yours is resting" or "this much is" depending only on who owns the order, and the note follows.
 * A note that ignored ownership would show every trader the market maker's committed size.
 */
test("a resting order changing hands is what makes the note appear", () => {
  const balances = { cngn: 41_470.685_234, usdc: 31.028_472_772_594_67 };

  const asVisitor = readHeader(buildLiveBook(), TRADER, balances);
  expect(asVisitor.committed).toEqual({ cngn: 0, usdc: 0 });
  expect(asVisitor.cngnNote).toBeNull();
  expect(asVisitor.usdcNote).toBeNull();

  // One order flips to this trader: the UI buy, which claims size × price in cNGN.
  const withOwnBid = readHeader(buildLiveBook({ askOwner: TRADER }), TRADER, balances);
  expect(withOwnBid.committed.cngn).toBeCloseTo(1.199_404 * 1374.015_66, 6);
  expect(withOwnBid.committed.usdc).toBe(0);
  // Which is the engine's own `desired_amount` for that order, 1648 cNGN, to the kobo.
  expect(withOwnBid.cngnNote).toBe("1,648 cNGN");
  expect(withOwnBid.usdcNote).toBeNull();

  // The other order is a UI sell, so it claims USDC rather than cNGN.
  const withOwnAsk = readHeader(buildLiveBook({ bidOwner: TRADER }), TRADER, balances);
  expect(withOwnAsk.committed.usdc).toBeCloseTo(1.199_829, 6);
  expect(withOwnAsk.cngnNote).toBeNull();
  expect(withOwnAsk.usdcNote).toBe("1.2 USDC");
});

/**
 * Balances carry their ticker; the ₦ sign belongs to prices.
 *
 * The header used to print the cNGN balance as "₦41,470.69" beside a bare "31.03" for USDC — one
 * holding dressed as a price, the other with no unit at all, while the Assets tab and the wallet
 * labels beside them already read "41,470.69 cNGN". Every balance on screen now takes the same
 * shape, so two figures for the same asset can only differ in quantity.
 */
test("balances are ticker-formatted and never wear the naira sign", () => {
  expect(formatBalance(1300, "cNGN")).toBe("1,300 cNGN");
  expect(formatBalance(3.94, "USDC")).toBe("3.94 USDC");

  for (const label of [
    formatAccountCngn(1300),
    formatAccountCngn(2_140_000),
    formatAccountUsdc(3.94),
  ]) {
    expect(label).not.toContain("₦");
  }
});

/** The ticket names the currency in its own row label, so it takes the figure without the symbol. */
test("the bare figure matches its ticker form minus the symbol", () => {
  expect(formatBalanceFigure(1300, "cNGN")).toBe("1,300");
  expect(formatBalanceFigure(2_140_000, "cNGN")).toBe("2.1M");
  expect(formatBalanceFigure(3.94, "USDC")).toBe("3.94");
  expect(formatBalanceFigure(null, "USDC")).toBe("—");
});
