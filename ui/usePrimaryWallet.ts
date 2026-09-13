"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useEffect, useSyncExternalStore } from "react";
import {
  getWalletPinKey,
  parseStoredWalletAddress,
  resolvePrimaryWallet,
} from "@/lib/wallet-selection";

/*
 * One store for every caller. The header's wallet button and the terminal each used to pick a
 * wallet on their own, so they could disagree about who the trader was; both now read this.
 *
 * Pins live in localStorage so a reload keeps the choice, with an in-memory copy for browsers that
 * block storage — losing the pin there would bring the silent switch straight back.
 */
const memoryPins = new Map<string, string>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changing the pin should move this one too.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readPin(userId: string | null) {
  if (userId === null) {
    return null;
  }
  try {
    return (
      parseStoredWalletAddress(window.localStorage.getItem(getWalletPinKey(userId))) ??
      memoryPins.get(userId) ??
      null
    );
  } catch {
    return memoryPins.get(userId) ?? null;
  }
}

function writePin(userId: string, address: string) {
  memoryPins.set(userId, address);
  try {
    window.localStorage.setItem(getWalletPinKey(userId), address);
  } catch {
    // The in-memory pin still holds for this page.
  }
  notify();
}

/**
 * The connected wallet the app acts as, held steady for the session (see `resolvePrimaryWallet`).
 *
 * A pin is written only when there is none: if the pinned wallet simply has not finished
 * connecting yet, overwriting it with whichever wallet is showing would lock the session onto the
 * wrong one — the original bug in another form. Until it connects the fallback stands in, and the
 * pinned wallet takes over again when it appears. `selectWallet` is the one way to change a pin.
 */
export function usePrimaryWallet() {
  const { authenticated, ready, user } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const userId = ready && authenticated ? (user?.id ?? null) : null;

  const pinnedAddress = useSyncExternalStore(
    subscribe,
    () => readPin(userId),
    () => null
  );
  const primaryWallet =
    userId === null
      ? null
      : resolvePrimaryWallet({
          loginWalletAddress: user?.wallet?.address ?? null,
          pinnedAddress,
          wallets,
        });
  const primaryAddress = primaryWallet?.address ?? null;

  useEffect(() => {
    if (userId === null || !walletsReady || primaryAddress === null || pinnedAddress !== null) {
      return;
    }
    writePin(userId, primaryAddress);
  }, [userId, walletsReady, primaryAddress, pinnedAddress]);

  /** Makes `address` the wallet the app acts as, for this user, until they choose another. */
  function selectWallet(address: string) {
    if (userId !== null) {
      writePin(userId, address);
    }
  }

  return { primaryWallet, selectWallet, wallets, walletsReady };
}
