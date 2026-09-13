const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const PIN_KEY_PREFIX = "numo.primary-wallet.v1";

/**
 * Which connected wallet the app acts as.
 *
 * It used to be "the one picked on the deposit dialog, else `wallets[0]`". The connected-wallets
 * list is not ordered stably — a second wallet that finishes connecting after load can land first —
 * so a trader who had picked nothing was silently switched to another wallet mid-session, and the
 * header, balances, Open Orders and every signature moved with it (2026-09-13: 0xeaBc…bFcA became
 * 0x2D72…AE2D a moment after load, and Open Orders emptied).
 *
 * In order: the wallet pinned for this user, while it is connected; the wallet the Privy account
 * signed in with; the first wallet linked to the account; the first connected wallet.
 */
export function resolvePrimaryWallet<Wallet extends { address: string; linked?: boolean }>({
  loginWalletAddress,
  pinnedAddress,
  wallets,
}: {
  /** `user.wallet.address` — the wallet the Privy account authenticated with, when it has one. */
  loginWalletAddress: string | null;
  pinnedAddress: string | null;
  wallets: readonly Wallet[];
}): Wallet | null {
  function connected(address: string | null) {
    if (address === null) {
      return undefined;
    }
    const target = address.toLowerCase();
    return wallets.find((wallet) => wallet.address.toLowerCase() === target);
  }

  return (
    connected(pinnedAddress) ??
    connected(loginWalletAddress) ??
    wallets.find((wallet) => wallet.linked === true) ??
    wallets[0] ??
    null
  );
}

/** Where a user's pinned wallet is remembered, so a reload does not reopen the choice. */
export function getWalletPinKey(userId: string) {
  return `${PIN_KEY_PREFIX}.${userId}`;
}

/** Parses a stored pin, returning null for anything that is not an address. */
export function parseStoredWalletAddress(raw: string | null) {
  const value = raw?.trim() ?? "";
  return ADDRESS_PATTERN.test(value) ? value : null;
}
