"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import {
  getCngnTokenAddress,
  getDepositableCurrencies,
  getEurcTokenAddress,
} from "@/lib/subaccount-deposit-config";
import { useServerRefresh } from "@/ui/trading-terminal/useServerRefresh";
import { useTokenBalance } from "@/ui/trading-terminal/useTokenBalance";
import { useTradingSubaccount } from "@/ui/trading-terminal/useTradingSubaccount";
import { useUsdcBalance } from "@/ui/trading-terminal/useUsdcBalance";
import { usePrimaryWallet } from "@/ui/usePrimaryWallet";

/**
 * What every market shares and a market switch must not reset: the session, the wallet the app
 * acts as, its trading account and its wallet-held balances. Held by the shell's layout, so the
 * panels under it mount and unmount per market while these persist.
 */
export type TerminalSession = {
  /** Stays false while Privy is still restoring a session, so account-scoped panels never flash for visitors. */
  isSignedIn: boolean;
  /** Starts the wallet login. No callbacks: PrivyWalletButton owns the analytics side of login. */
  login: () => void;
  /**
   * Which connected wallet the terminal is acting as, gated on the session rather than on the
   * wallet list: an extension can be connected without Privy having issued a session (a login
   * abandoned at the signature step, a logout that left the extension connected), and acting as
   * that wallet made the header offer "Connect Wallet" over a live Buy button. Held steady by
   * `usePrimaryWallet`, changed only by `selectWallet`.
   */
  primaryWallet: ConnectedWallet | null;
  /** Makes `address` the wallet the app acts as; it moves the whole identity, not just who signs. */
  selectWallet: (address: string) => void;
  /** Every wallet Privy has connected, for the deposit dialog's Transfer from screen. */
  wallets: ConnectedWallet[];
  walletsReady: boolean;
  /**
   * The wallet's one trading account, under the MarginEngine since 2026-10-13: spot and the future
   * trade from it, so spot holdings and futures positions margin one balance. The perp, which is
   * winding down, resolves its own account under its SRM.
   */
  account: ReturnType<typeof useTradingSubaccount>;
  /** The wallet's own USDC, cNGN and EURC, which a deposit draws on. */
  walletBalances: {
    cngn: ReturnType<typeof useTokenBalance>["balance"];
    eurc: ReturnType<typeof useTokenBalance>["balance"];
    usdc: ReturnType<typeof useUsdcBalance>["balance"];
  };
  /**
   * Re-reads the wallet balances, at or past `blockNumber` when a transfer's receipt names one:
   * reading latest could hit an RPC node a block behind and leave the pre-transfer figures up.
   */
  refreshWalletBalances: (blockNumber?: bigint | null) => void;
};

const TerminalSessionContext = createContext<TerminalSession | null>(null);

export function TerminalSessionProvider({ children }: { children: ReactNode }) {
  const { authenticated, ready: privyReady } = usePrivy();
  const { login } = useLogin();
  const { primaryWallet: pinnedWallet, selectWallet, wallets, walletsReady } = usePrimaryWallet();
  const isSignedIn = privyReady && authenticated;
  const primaryWallet = isSignedIn ? pinnedWallet : null;
  const walletAddress = primaryWallet?.address ?? null;
  const account = useTradingSubaccount(walletAddress);
  const usdc = useUsdcBalance(walletAddress);
  const cngn = useTokenBalance(walletAddress, getCngnTokenAddress());
  // Read only where EURC is deposited here; null otherwise, and the read never runs.
  const eurc = useTokenBalance(
    walletAddress,
    getDepositableCurrencies().includes("EURC") ? getEurcTokenAddress() : null
  );
  // The minute's re-read of the server render, for whichever market is on screen.
  useServerRefresh();

  function refreshWalletBalances(blockNumber: bigint | null = null) {
    usdc.refresh(blockNumber);
    cngn.refresh(blockNumber);
    eurc.refresh(blockNumber);
  }

  return (
    <TerminalSessionContext.Provider
      value={{
        account,
        isSignedIn,
        login,
        primaryWallet,
        refreshWalletBalances,
        selectWallet,
        walletBalances: { cngn: cngn.balance, eurc: eurc.balance, usdc: usdc.balance },
        wallets,
        walletsReady,
      }}
    >
      {children}
    </TerminalSessionContext.Provider>
  );
}

/** The shell's session; only for components rendered under `TerminalShell`. */
export function useTerminalSession(): TerminalSession {
  const session = useContext(TerminalSessionContext);
  if (session === null) {
    throw new Error("useTerminalSession must be used under TerminalShell");
  }
  return session;
}
