import { expect, test } from "bun:test";
import {
  getWalletPinKey,
  parseStoredWalletAddress,
  resolvePrimaryWallet,
} from "./wallet-selection.ts";

const TRADING = { address: "0xeaBca823B4d35d8F2eac09edB55C42D8077fbFcA", linked: true };
const OTHER = { address: "0x2D724867d3AeD4A9F09c096B87F939285DD3AE2D", linked: true };
const UNLINKED = { address: "0x0000000000000000000000000000000000000001", linked: false };

/**
 * The 2026-09-13 flip: the list reordered with 0x2D72 first a moment after load. A pinned wallet that
 * is still connected keeps its place however the list is ordered.
 */
test("a pinned wallet stays in charge when the list reorders", () => {
  const before = resolvePrimaryWallet({
    loginWalletAddress: null,
    pinnedAddress: TRADING.address,
    wallets: [TRADING, OTHER],
  });
  const after = resolvePrimaryWallet({
    loginWalletAddress: null,
    pinnedAddress: TRADING.address,
    wallets: [OTHER, TRADING],
  });

  expect(before).toBe(TRADING);
  expect(after).toBe(TRADING);
});

test("a pin matches regardless of address casing", () => {
  expect(
    resolvePrimaryWallet({
      loginWalletAddress: null,
      pinnedAddress: TRADING.address.toLowerCase(),
      wallets: [OTHER, TRADING],
    })
  ).toBe(TRADING);
});

test("while the pinned wallet is not connected, the sign-in wallet is used", () => {
  expect(
    resolvePrimaryWallet({
      loginWalletAddress: OTHER.address,
      pinnedAddress: "0x0000000000000000000000000000000000000009",
      wallets: [UNLINKED, OTHER],
    })
  ).toBe(OTHER);
});

test("with no pin, the wallet the account signed in with wins over list order", () => {
  expect(
    resolvePrimaryWallet({ loginWalletAddress: TRADING.address, pinnedAddress: null, wallets: [OTHER, TRADING] })
  ).toBe(TRADING);
});

/** An extension connected to the page but not linked to the Privy account is the last resort. */
test("with neither, a wallet linked to the account beats one that is merely connected", () => {
  expect(
    resolvePrimaryWallet({ loginWalletAddress: null, pinnedAddress: null, wallets: [UNLINKED, OTHER] })
  ).toBe(OTHER);
  expect(
    resolvePrimaryWallet({ loginWalletAddress: null, pinnedAddress: null, wallets: [UNLINKED] })
  ).toBe(UNLINKED);
});

test("no connected wallet resolves to none", () => {
  expect(
    resolvePrimaryWallet({ loginWalletAddress: TRADING.address, pinnedAddress: TRADING.address, wallets: [] })
  ).toBeNull();
});

test("a stored pin is kept only when it is an address", () => {
  expect(parseStoredWalletAddress(TRADING.address)).toBe(TRADING.address);
  expect(parseStoredWalletAddress(` ${TRADING.address} `)).toBe(TRADING.address);
  expect(parseStoredWalletAddress(null)).toBeNull();
  expect(parseStoredWalletAddress("0x123")).toBeNull();
  expect(parseStoredWalletAddress('{"address":"0x"}')).toBeNull();
});

test("pins are kept per Privy user", () => {
  expect(getWalletPinKey("did:privy:a")).not.toBe(getWalletPinKey("did:privy:b"));
});
