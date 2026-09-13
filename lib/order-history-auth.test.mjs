import { expect, test } from "bun:test";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildOrderHistoryAuthMessage,
  createOrderHistoryAuthDraft,
  encodeOrderHistoryAuthHeader,
  isOrderHistoryAuthUsable,
  ORDER_HISTORY_AUTH_LIFETIME_SECONDS,
  parseOrderHistoryAuthFrame,
} from "./order-history-auth.ts";

const ADDRESS = "0xeaBca823B4d35d8F2eac09edB55C42D8077fbFcA";
const NOW = 1_789_324_800;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * markets-service rebuilds this string and recovers the signer from it, so it is a wire contract:
 * `wsauth.Verifier.Message` with `OrderHistoryStatement`, the address lowercased.
 */
test("the signed message is exactly what markets-service verifies", () => {
  const message = buildOrderHistoryAuthMessage({
    address: ADDRESS,
    domain: "markets.numo.xyz",
    expiry: NOW + 43_200,
    issuedAt: NOW,
    nonce: "3f1c",
  });

  expect(message).toBe(
    "markets.numo.xyz wants you to view your Numo order history.\n" +
      "Address: 0xeabca823b4d35d8f2eac09edb55c42d8077fbfca\n" +
      "Nonce: 3f1c\n" +
      "Issued At: 1789324800\n" +
      "Expiration Time: 1789368000"
  );
});

/** The service refuses frames longer than 24 hours, so the app must never sign one. */
test("a login lasts 12 hours, inside the service's 24-hour limit", () => {
  const draft = createOrderHistoryAuthDraft({ address: ADDRESS, nonce: "n", nowSeconds: NOW });

  expect(ORDER_HISTORY_AUTH_LIFETIME_SECONDS).toBe(43_200);
  expect(draft.expiry - draft.issued_at).toBeLessThan(86_400);
  expect(draft.address).toBe(ADDRESS.toLowerCase());
});

test("the header is unpadded base64url JSON of the frame", () => {
  const frame = { ...createOrderHistoryAuthDraft({ address: ADDRESS, nonce: "n?>", nowSeconds: NOW }), signature: "0xabc" };
  const header = encodeOrderHistoryAuthHeader(frame);

  expect(header).toMatch(BASE64URL);
  const decoded = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  expect(decoded).toEqual(frame);
});

/** A real personal_sign over the message recovers the frame's address — what the server checks. */
test("a wallet signature over the message recovers the frame's address", async () => {
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const draft = createOrderHistoryAuthDraft({ address: account.address, nonce: "sig", nowSeconds: NOW });
  const message = buildOrderHistoryAuthMessage({
    address: draft.address,
    domain: "markets.numo.xyz",
    expiry: draft.expiry,
    issuedAt: draft.issued_at,
    nonce: draft.nonce,
  });
  const signature = await account.signMessage({ message });

  expect(await verifyMessage({ address: draft.address, message, signature })).toBe(true);
});

test("a cached login is reused only for its own wallet and not near expiry", () => {
  const frame = { ...createOrderHistoryAuthDraft({ address: ADDRESS, nonce: "n", nowSeconds: NOW }), signature: "0xabc" };

  expect(isOrderHistoryAuthUsable(frame, ADDRESS, NOW + 60)).toBe(true);
  expect(isOrderHistoryAuthUsable(frame, "0x0000000000000000000000000000000000000001", NOW)).toBe(false);
  expect(isOrderHistoryAuthUsable(frame, ADDRESS, frame.expiry - 30)).toBe(false);
  expect(isOrderHistoryAuthUsable(null, ADDRESS, NOW)).toBe(false);
  expect(isOrderHistoryAuthUsable(frame, null, NOW)).toBe(false);
});

test("a malformed stored login parses to nothing", () => {
  expect(parseOrderHistoryAuthFrame(null)).toBeNull();
  expect(parseOrderHistoryAuthFrame("not json")).toBeNull();
  expect(parseOrderHistoryAuthFrame(JSON.stringify({ address: ADDRESS }))).toBeNull();

  const frame = { address: "0xa", expiry: 2, issued_at: 1, nonce: "n", signature: "0xs" };
  expect(parseOrderHistoryAuthFrame(JSON.stringify(frame))).toEqual(frame);
});
