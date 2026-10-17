/**
 * Rests a ladder of limit orders on a cNGN future through markets-service, or cancels one.
 *
 * Builds and signs each order exactly as the terminal does (`lib/spot-order-submission.ts`): an
 * EIP-712 `Action` on Matching for the series' asset and sub id on its TradeModule, the price as
 * 18-decimal cNGN per USDC, the size in whole USDC signed as the market's `amount_scale`, and the
 * fee ceiling at 3 USDC a contract. Nothing is sent without `--send`.
 *
 *   bun scripts/future-ladder.ts                      # dry run: print every order, sign nothing
 *   bun scripts/future-ladder.ts --send               # sign and post the ladder
 *   bun scripts/future-ladder.ts --status             # this account's resting orders on the series
 *   bun scripts/future-ladder.ts --cancel --send      # cancel every one of them
 *
 * Options:
 *   --rung PRICE:SIZE     an order at PRICE (cNGN per USDC) for SIZE whole USDC; repeat per rung
 *                         (default: the six-rung 14,000 USDC ladder below)
 *   --side buy|sell       default buy (long the future, short naira)
 *   --expiry-hours N      default 24
 *   --allow-cross         post a rung that would cross the opposite touch (pays the taker fee)
 *
 * Env:
 *   LADDER_PRIVATE_KEY    the signing key: the owner's, or a session key registered on Matching
 *                         (`registerSessionKey`) for the owner. Never printed.
 *   LADDER_OWNER          the owner address; defaults to the key's address
 *   LADDER_SUBACCOUNT     the trading subaccount id (required)
 *   LADDER_SYMBOL         default USDC-cNGN-30NOV26
 *   MARKETS_SERVICE_URL   default https://api.numofx.com
 *   MATCHING_ADDRESS      default the Base mainnet Matching
 */

import { parseArgs } from "node:util";
import type { Address, Hex, PrivateKeyAccount } from "viem";
import { encodeAbiParameters, getAddress, isAddress, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = 8453;
const ENGINE_DECIMALS = 18;
const WORST_FEE_RATE_BPS = 30n;
const NONCE_SEQUENCE_RANGE = 2n ** 12n;
const CANCEL_LIFETIME_SECONDS = 120n;
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
const UNSIGNED_INTEGER_PATTERN = /^\d+$/;
const TRAILING_ZEROES_PATTERN = /0+$/;
const TRAILING_SLASH_PATTERN = /\/$/;
const PRIVATE_KEY_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;

/** 14,000 USDC: closes a 3,938 short, then ~10,060 net long. */
const DEFAULT_RUNGS: Rung[] = [
  { price: "1380", size: 1600 },
  { price: "1378", size: 2000 },
  { price: "1375", size: 2300 },
  { price: "1372", size: 2600 },
  { price: "1369", size: 2900 },
  { price: "1366", size: 2600 },
];

type Rung = { price: string; size: number };

type Side = "buy" | "sell";

type FutureListing = {
  market: string;
  asset_address: string;
  sub_id: string;
  trade_module_address: string;
  amount_scale?: string;
  fill_band_low?: string;
  fill_band_high?: string;
  future?: { contract_size_usdc?: string; trading_open?: boolean };
};

type BookOrder = {
  owner_address: string;
  subaccount_id: string;
  nonce: string;
  side: Side;
  limit_price: string;
  desired_amount: string;
  filled_amount: string;
};

type Book = { asks: BookOrder[]; bids: BookOrder[] };

type Series = {
  amountScale: bigint;
  asset: Address;
  bandHigh: number;
  bandLow: number;
  contractSize: number;
  module: Address;
  subId: bigint;
  worstFee: bigint;
};

type Context = {
  baseUrl: string;
  matching: Address;
  owner: Address;
  signer: PrivateKeyAccount | null;
  subaccountId: string;
  symbol: string;
};

const ACTION_TYPES = {
  Action: [
    { name: "subaccountId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "module", type: "address" },
    { name: "data", type: "bytes" },
    { name: "expiry", type: "uint256" },
    { name: "owner", type: "address" },
    { name: "signer", type: "address" },
  ],
} as const;

const CANCEL_TYPES = {
  Cancel: [
    { name: "owner", type: "address" },
    { name: "signer", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

const TRADE_DATA = [
  {
    type: "tuple",
    components: [
      { name: "asset", type: "address" },
      { name: "subId", type: "uint256" },
      { name: "limitPrice", type: "int256" },
      { name: "desiredAmount", type: "int256" },
      { name: "worstFee", type: "uint256" },
      { name: "recipientId", type: "uint256" },
      { name: "isBid", type: "bool" },
    ],
  },
] as const;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function domainOf(matching: Address) {
  return {
    chainId: CHAIN_ID,
    name: "Matching",
    verifyingContract: matching,
    version: "1.0",
  } as const;
}

/** A decimal string to an 18-decimal integer, exactly; refuses more precision than the engine has. */
function toWei(decimal: string): bigint {
  if (!DECIMAL_PATTERN.test(decimal)) {
    fail(`not a positive decimal: ${decimal}`);
  }
  const [whole, fraction = ""] = decimal.split(".");
  if (fraction.length > ENGINE_DECIMALS) {
    fail(`more than 18 decimals: ${decimal}`);
  }
  return BigInt(whole + fraction.padEnd(ENGINE_DECIMALS, "0"));
}

function formatWei(wei: bigint): string {
  const unit = 10n ** BigInt(ENGINE_DECIMALS);
  const fraction = (wei % unit)
    .toString()
    .padStart(ENGINE_DECIMALS, "0")
    .replace(TRAILING_ZEROES_PATTERN, "");
  return fraction === "" ? (wei / unit).toString() : `${wei / unit}.${fraction}`;
}

let lastNonce = 0n;
/** Clock-ordered and under 2^53, like the terminal's: the venue's tooling reads nonces as floats. */
function nextNonce(): bigint {
  const fromClock = BigInt(Date.now()) * NONCE_SEQUENCE_RANGE + BigInt(process.pid % 4096);
  lastNonce = fromClock > lastNonce ? fromClock : lastNonce + 1n;
  return lastNonce;
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { accept: "application/json", "content-type": "application/json" },
  });
  const body = (await response.json().catch(() => null)) as T | null;
  return { body, ok: response.ok, status: response.status };
}

function parseRung(value: string): Rung {
  const [price, size] = value.split(":");
  const units = Number(size);
  if (price === undefined || !Number.isInteger(units) || units < 1) {
    fail(`--rung wants PRICE:SIZE with SIZE in whole USDC, got ${value}`);
  }
  return { price, size: units };
}

function requireSigner(context: Context): PrivateKeyAccount {
  return context.signer ?? fail("this needs LADDER_PRIVATE_KEY");
}

/** The signing key, trimmed and `0x`-prefixed; a malformed one fails without echoing it. */
function readPrivateKey(): Hex | null {
  const raw = process.env.LADDER_PRIVATE_KEY?.trim();
  if (raw === undefined || raw === "") {
    return null;
  }
  if (!PRIVATE_KEY_PATTERN.test(raw)) {
    fail(
      `LADDER_PRIVATE_KEY must be 64 hex characters, with or without 0x (got ${raw.length} characters)`
    );
  }
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

function readContext(): Context {
  const subaccountId = process.env.LADDER_SUBACCOUNT ?? fail("set LADDER_SUBACCOUNT");
  if (!UNSIGNED_INTEGER_PATTERN.test(subaccountId)) {
    fail("LADDER_SUBACCOUNT must be an unsigned integer");
  }
  const key = readPrivateKey();
  const signer = key === null ? null : privateKeyToAccount(key);
  const ownerEnv = process.env.LADDER_OWNER;
  if (ownerEnv !== undefined && !isAddress(ownerEnv)) {
    fail("LADDER_OWNER is not an address");
  }
  const owner =
    ownerEnv === undefined
      ? (signer?.address ?? fail("set LADDER_PRIVATE_KEY or LADDER_OWNER"))
      : getAddress(ownerEnv);
  return {
    baseUrl: (process.env.MARKETS_SERVICE_URL ?? "https://api.numofx.com").replace(
      TRAILING_SLASH_PATTERN,
      ""
    ),
    matching: getAddress(
      process.env.MATCHING_ADDRESS ?? "0x9E90A9cD13d859Bd6a08168082FB1F6F7405F191"
    ),
    owner,
    signer,
    subaccountId,
    symbol: process.env.LADDER_SYMBOL ?? "USDC-cNGN-30NOV26",
  };
}

async function readSeries(context: Context): Promise<Series> {
  const markets = await requestJson<FutureListing[]>(`${context.baseUrl}/v1/markets`);
  const listing = markets.body?.find((market) => market.market === context.symbol);
  if (!(markets.ok && listing)) {
    fail(`${context.symbol} is not listed on ${context.baseUrl}`);
  }
  if (listing.future?.trading_open === false) {
    fail(`${context.symbol} is not open for trading`);
  }
  const contractSize = Number(listing.future?.contract_size_usdc ?? "1000");
  return {
    amountScale: BigInt(listing.amount_scale ?? (10n ** BigInt(ENGINE_DECIMALS)).toString()),
    asset: getAddress(listing.asset_address),
    bandHigh: Number(listing.fill_band_high),
    bandLow: Number(listing.fill_band_low),
    contractSize,
    module: getAddress(listing.trade_module_address),
    subId: BigInt(listing.sub_id),
    // The terminal's ceiling: 30 bps of a contract, per contract (3 USDC on 1,000), 18 decimals.
    worstFee: (BigInt(Math.round(contractSize * 1e6)) * WORST_FEE_RATE_BPS * 10n ** 12n) / 10_000n,
  };
}

async function readBook(context: Context, series: Series): Promise<Book> {
  const book = await requestJson<Book>(
    `${context.baseUrl}/v1/book?asset_address=${series.asset}&sub_id=${series.subId}`
  );
  if (!(book.ok && book.body)) {
    fail(`book returned ${book.status}`);
  }
  return book.body;
}

function ownOrders(book: Book, owner: Address) {
  return [...book.bids, ...book.asks].filter((order) => getAddress(order.owner_address) === owner);
}

async function statusOrCancel(context: Context, series: Series, cancel: boolean, send: boolean) {
  const mine = ownOrders(await readBook(context, series), context.owner);
  if (mine.length === 0) {
    console.log(`No resting orders for ${context.owner} on ${context.symbol}.`);
    return;
  }
  for (const order of mine) {
    const left = Number(order.desired_amount) - Number(order.filled_amount);
    console.log(
      `${order.side.padEnd(4)} ${Number(order.limit_price).toFixed(2).padStart(9)}  ${String(left).padStart(6)} USDC left  sub ${order.subaccount_id}  nonce ${order.nonce}`
    );
  }
  if (!cancel) {
    return;
  }
  if (!send) {
    console.log(`\nDry run: would cancel ${mine.length}. Add --send to cancel.`);
    return;
  }
  const signer = requireSigner(context);
  for (const order of mine) {
    const expiry = BigInt(Math.floor(Date.now() / 1000)) + CANCEL_LIFETIME_SECONDS;
    const signature = await signer.signTypedData({
      domain: domainOf(context.matching),
      message: { expiry, nonce: BigInt(order.nonce), owner: context.owner, signer: signer.address },
      primaryType: "Cancel",
      types: CANCEL_TYPES,
    });
    const result = await requestJson<{ error?: string }>(`${context.baseUrl}/v1/orders/cancel`, {
      body: JSON.stringify({
        expiry: expiry.toString(),
        nonce: order.nonce,
        owner_address: context.owner,
        signature,
        signer_address: signer.address,
      }),
      method: "POST",
    });
    const outcome = result.ok ? "ok" : `${result.status} ${result.body?.error ?? ""}`;
    console.log(`cancel ${order.side} ${order.limit_price.slice(0, 8)}: ${outcome}`);
  }
}

/** The best opposite price from anyone but this account; null when that side is empty. */
function oppositeTouch(book: Book, side: Side, owner: Address): number | null {
  const prices = (side === "buy" ? book.asks : book.bids)
    .filter((order) => getAddress(order.owner_address) !== owner)
    .map((order) => Number(order.limit_price));
  if (prices.length === 0) {
    return null;
  }
  return side === "buy" ? Math.min(...prices) : Math.max(...prices);
}

function checkRung(
  rung: Rung,
  inputs: {
    allowCross: boolean;
    ownOpposite: number[];
    series: Series;
    side: Side;
    touch: number | null;
  }
): string[] {
  const price = Number(rung.price);
  const crosses = (other: number) => (inputs.side === "buy" ? price >= other : price <= other);
  const problems: string[] = [];
  if (price < inputs.series.bandLow || price > inputs.series.bandHigh) {
    problems.push(`${rung.price} is outside the fill band`);
  }
  if (inputs.touch !== null && crosses(inputs.touch) && !inputs.allowCross) {
    problems.push(
      `${rung.price} crosses the opposite touch ${inputs.touch.toFixed(2)} (taker fee); --allow-cross to send it`
    );
  }
  if (inputs.ownOpposite.some(crosses)) {
    problems.push(`${rung.price} would trade against this account's own resting order`);
  }
  return problems;
}

function buildOrder(context: Context, series: Series, side: Side, rung: Rung, expiry: bigint) {
  const limitPrice = toWei(rung.price);
  const desiredAmount = BigInt(rung.size) * series.amountScale;
  const nonce = nextNonce();
  const signerAddress = context.signer?.address ?? context.owner;
  const data = encodeAbiParameters(TRADE_DATA, [
    {
      asset: series.asset,
      desiredAmount,
      isBid: side === "buy",
      limitPrice,
      recipientId: BigInt(context.subaccountId),
      subId: series.subId,
      worstFee: series.worstFee,
    },
  ]);
  const action = {
    data,
    expiry,
    module: series.module,
    nonce,
    owner: context.owner,
    signer: signerAddress,
    subaccountId: BigInt(context.subaccountId),
  };
  const body = {
    asset_address: series.asset,
    desired_amount: String(rung.size),
    expiry: Number(expiry),
    filled_amount: "0",
    limit_price: formatWei(limitPrice),
    nonce: nonce.toString(),
    order_id: `future-${crypto.randomUUID()}`,
    owner_address: context.owner,
    recipient_id: context.subaccountId,
    action_json: {
      data,
      expiry: expiry.toString(),
      module: series.module,
      nonce: nonce.toString(),
      owner: context.owner,
      signer: signerAddress,
      subaccount_id: context.subaccountId,
    },
    side,
    signer_address: signerAddress,
    sub_id: series.subId.toString(),
    subaccount_id: context.subaccountId,
    worst_fee: series.worstFee.toString(),
  };
  return { action, body, desiredAmount, rung };
}

async function placeLadder(
  context: Context,
  series: Series,
  options: { allowCross: boolean; expiryHours: number; rungs: Rung[]; send: boolean; side: Side }
) {
  const { side } = options;
  const book = await readBook(context, series);
  const touch = oppositeTouch(book, side, context.owner);
  const ownOpposite = ownOrders(book, context.owner)
    .filter((order) => order.side !== side)
    .map((order) => Number(order.limit_price));
  const expiry = BigInt(Math.floor(Date.now() / 1000 + options.expiryHours * 3600));
  const sessionNote =
    context.signer && context.signer.address !== context.owner ? "  (session key)" : "";

  console.log(
    `${context.symbol}  ${side === "buy" ? "LONG (buy)" : "SHORT (sell)"}  owner ${context.owner}  sub ${context.subaccountId}`
  );
  console.log(`signer ${context.signer?.address ?? "(none: dry run only)"}${sessionNote}`);
  console.log(
    `band ${series.bandLow.toFixed(2)}–${series.bandHigh.toFixed(2)}  opposite touch ${touch?.toFixed(2) ?? "none"}  expiry ${new Date(Number(expiry) * 1000).toISOString()}\n`
  );

  const problems = options.rungs.flatMap((rung) =>
    checkRung(rung, { allowCross: options.allowCross, ownOpposite, series, side, touch })
  );
  const orders = options.rungs.map((rung) => buildOrder(context, series, side, rung, expiry));
  for (const { action, body, desiredAmount, rung } of orders) {
    console.log(
      `${side} ${body.limit_price.padStart(6)}  ${String(rung.size).padStart(6)} USDC  (${(rung.size / series.contractSize).toFixed(3)} contracts)  signed amount ${desiredAmount}  nonce ${action.nonce}`
    );
  }
  const total = options.rungs.reduce((sum, rung) => sum + rung.size, 0);
  console.log(
    `total ${total.toLocaleString()} USDC  fee ceiling ${formatWei(series.worstFee)} USDC a contract`
  );

  if (problems.length > 0) {
    fail(`refusing:\n  ${problems.join("\n  ")}`);
  }
  if (!options.send) {
    console.log("\nDry run: nothing signed or sent. Add --send to post.");
    return;
  }

  const signer = requireSigner(context);
  const domain = domainOf(context.matching);
  const placed: string[] = [];
  for (const { action, body } of orders) {
    const typed = { domain, message: action, primaryType: "Action", types: ACTION_TYPES } as const;
    const signature = await signer.signTypedData(typed);
    if (!(await verifyTypedData({ ...typed, address: signer.address, signature }))) {
      fail(`signature for ${body.limit_price} does not verify; stopping`);
    }
    const result = await requestJson<{ error?: string }>(`${context.baseUrl}/v1/orders`, {
      body: JSON.stringify({ ...body, signature }),
      method: "POST",
    });
    if (!result.ok) {
      fail(
        `${body.limit_price} refused (${result.status}): ${result.body?.error ?? "no error body"}; stopping after ${placed.length} posted`
      );
    }
    placed.push(body.nonce);
    console.log(`posted ${side} ${body.limit_price} x ${body.desired_amount}`);
  }

  // Read the book back: each posted nonce should rest, or have filled.
  const resting = new Set(
    ownOrders(await readBook(context, series), context.owner).map((order) => order.nonce)
  );
  const missing = placed.filter((nonce) => !resting.has(nonce));
  const missingNote =
    missing.length > 0 ? ` Not on the book (filled or dropped): nonces ${missing.join(", ")}` : "";
  console.log(`\n${placed.length - missing.length}/${placed.length} resting.${missingNote}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      "allow-cross": { default: false, type: "boolean" },
      cancel: { default: false, type: "boolean" },
      "expiry-hours": { default: "24", type: "string" },
      rung: { multiple: true, type: "string" },
      send: { default: false, type: "boolean" },
      side: { default: "buy", type: "string" },
      status: { default: false, type: "boolean" },
    },
  });
  const context = readContext();
  const series = await readSeries(context);

  if (values.status || values.cancel) {
    await statusOrCancel(context, series, values.cancel, values.send);
    return;
  }
  if (values.side !== "buy" && values.side !== "sell") {
    fail("--side is buy or sell");
  }
  const expiryHours = Number(values["expiry-hours"]);
  if (!(expiryHours > 0)) {
    fail("--expiry-hours must be positive");
  }
  await placeLadder(context, series, {
    allowCross: values["allow-cross"],
    expiryHours,
    rungs: values.rung?.map(parseRung) ?? DEFAULT_RUNGS,
    send: values.send,
    side: values.side,
  });
}

await main();
