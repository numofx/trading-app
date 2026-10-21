import { expect, test } from "bun:test";
import { getAddress } from "viem";
import {
  EURC_DEPOSITS_UNAVAILABLE,
  fetchListedEurcEscrow,
  resolveEurcDepositEscrow,
} from "./eurc-deposit-escrow.ts";

// Placeholders: the real escrow is known only once it is deployed, and is never written into code.
const ESCROW = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const MIXED = "0xAbCdEf0123456789abcdef0123456789ABCDEF01";

/** A refusal as resolveEurcDepositEscrow returns one: no escrow, the trader's message, and why. */
function refusal(reason) {
  return { message: EURC_DEPOSITS_UNAVAILABLE, ok: false, reason: expect.stringContaining(reason) };
}

test("the venue and the build agree: the deposit pays into that escrow", () => {
  expect(resolveEurcDepositEscrow(ESCROW, ESCROW)).toEqual({
    escrow: getAddress(ESCROW),
    ok: true,
  });
});

test("the comparison ignores case: a checksummed config matches the venue's lowercase listing", () => {
  const result = resolveEurcDepositEscrow(MIXED.toLowerCase(), MIXED);
  expect(result).toEqual({ escrow: getAddress(MIXED), ok: true });
});

test("they differ: refused, and neither address is used", () => {
  expect(resolveEurcDepositEscrow(ESCROW, OTHER)).toEqual(
    refusal(`the venue lists ${ESCROW}, this build is configured with ${OTHER}`)
  );
});

test("the venue does not list EURC-USDC: refused, the configured escrow alone is not enough", () => {
  for (const listed of [null, undefined, "", "  "]) {
    expect(resolveEurcDepositEscrow(listed, ESCROW)).toEqual(
      refusal("EURC-USDC is not listed by the venue")
    );
  }
});

test("NEXT_PUBLIC_EURC_ASSET_ADDRESS is not set: refused, the venue's escrow alone is not enough", () => {
  for (const configured of [null, undefined, "", "  "]) {
    expect(resolveEurcDepositEscrow(ESCROW, configured)).toEqual(
      refusal("NEXT_PUBLIC_EURC_ASSET_ADDRESS is not set")
    );
  }
});

test("both missing: refused", () => {
  expect(resolveEurcDepositEscrow(null, undefined)).toEqual(
    refusal("EURC-USDC is not listed by the venue")
  );
});

test("an address that is not one is refused, on either side", () => {
  expect(resolveEurcDepositEscrow("0x1234", ESCROW)).toEqual(refusal("is not an address"));
  expect(resolveEurcDepositEscrow(ESCROW, "eurc-escrow")).toEqual(refusal("is not an address"));
});

/** A fetch stand-in answering `/api/eurc-escrow`. */
function fakeFetch(status, body, calls = []) {
  return (url, init) => {
    calls.push({ init, url });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

test("the venue's escrow is read uncached from /api/eurc-escrow at deposit time", async () => {
  const calls = [];
  expect(await fetchListedEurcEscrow(fakeFetch(200, { asset_address: ESCROW }, calls))).toBe(
    ESCROW
  );
  expect(calls).toEqual([{ init: { cache: "no-store" }, url: "/api/eurc-escrow" }]);
});

test("not listed, a failed route, a thrown fetch or a malformed body all read as missing, and refuse", async () => {
  const failing = [
    fakeFetch(200, {}),
    fakeFetch(502, {}),
    fakeFetch(200, { asset_address: 7 }),
    fakeFetch(200, null),
    () => Promise.reject(new TypeError("network down")),
  ];
  for (const fetcher of failing) {
    const listed = await fetchListedEurcEscrow(fetcher);
    expect(listed).toBeNull();
    expect(resolveEurcDepositEscrow(listed, ESCROW)).toEqual(
      refusal("EURC-USDC is not listed by the venue")
    );
  }
});
