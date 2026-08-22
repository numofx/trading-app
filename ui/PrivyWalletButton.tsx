"use client";

import { Menu } from "@base-ui/react/menu";
import { useLogin, useLogout, usePrivy, useWallets } from "@privy-io/react-auth";
import { LogOut, PieChart, Wallet } from "lucide-react";
import posthog from "posthog-js";
import { formatAddressShort } from "@/lib/address-display";
import { cn } from "@/lib/cn";

/** The shared pill shape, so the connected menu trigger and the connect button stay identical. */
const WALLET_PILL_CLASSNAME =
  "inline-flex h-10 cursor-pointer items-center gap-2 rounded-sm bg-[#9BDBF8] px-4 font-medium text-[#111111] text-[13px] outline-none ring-1 ring-black/10 transition-colors hover:bg-[#9BDBF8]/90";

export function PrivyWalletButton({ onPortfolioSelect }: { onPortfolioSelect?: () => void }) {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();

  if (!privyAppId) {
    return (
      <button
        aria-disabled="true"
        className="inline-flex h-10 items-center gap-2 rounded-sm bg-white px-4 font-medium text-[#111111] text-[13px] ring-1 ring-black/10"
        title="Set NEXT_PUBLIC_PRIVY_APP_ID to enable wallet login"
        type="button"
      >
        <Wallet className="size-3.5" />
        <span>Wallet Unconfigured</span>
      </button>
    );
  }

  return <PrivyWalletButtonInner onPortfolioSelect={onPortfolioSelect} />;
}

function PrivyWalletButtonInner({ onPortfolioSelect }: { onPortfolioSelect?: () => void }) {
  const { authenticated, ready } = usePrivy();
  const { login } = useLogin({
    onComplete: ({ user, loginAccount }) => {
      const walletAddress =
        loginAccount && "address" in loginAccount ? (loginAccount.address as string) : null;
      const distinctId = walletAddress ?? user.id;
      posthog.identify(distinctId);
      posthog.capture("wallet_connected", {
        is_new_user: false,
        login_method: loginAccount?.type ?? null,
        privy_user_id: user.id,
        wallet_address_truncated: walletAddress
          ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
          : null,
      });
    },
    onError: (error) => {
      if (error === "exited_auth_flow") {
        return;
      }

      console.error("Privy login error", error);
    },
  });
  const { logout } = useLogout({
    onSuccess: () => {
      posthog.capture("wallet_disconnected");
      posthog.reset();
    },
  });
  const { ready: walletsReady, wallets } = useWallets();
  const primaryWallet = wallets[0];
  const walletAddress = primaryWallet?.address ? formatAddressShort(primaryWallet.address) : null;
  const isReady = ready && walletsReady;

  // Connected: the pill becomes the menu trigger. Disconnecting moved in here, so a stray click on
  // the address no longer drops the session — it opens the menu and asks which action was meant.
  if (isReady && authenticated) {
    return (
      <Menu.Root>
        <Menu.Trigger className={WALLET_PILL_CLASSNAME}>
          <Wallet className="size-4" />
          <span>{walletAddress ?? "Wallet Connected"}</span>
        </Menu.Trigger>

        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={8}>
            <Menu.Popup className="z-50 min-w-(--anchor-width) overflow-hidden rounded-sm border border-panel-border bg-panel-bg-darker p-1.5 shadow-[0_20px_60px_var(--panel-shadow)] outline-none transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
              <Menu.Item
                className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px] text-panel-text outline-none transition-colors data-highlighted:bg-input-bg data-highlighted:text-panel-text-active"
                onClick={() => onPortfolioSelect?.()}
              >
                <PieChart className="size-4" />
                <span>Portfolio</span>
              </Menu.Item>
              <Menu.Item
                className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px] text-panel-text outline-none transition-colors data-highlighted:bg-input-bg data-highlighted:text-panel-text-active"
                onClick={() => {
                  void logout();
                }}
              >
                {/* Red on the glyph alone: it marks the destructive item without colouring the label. */}
                <LogOut className="size-4 text-sell" />
                <span>Disconnect</span>
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    );
  }

  return (
    <button
      className={cn(WALLET_PILL_CLASSNAME, !isReady && "cursor-wait opacity-80")}
      onClick={() => {
        if (!isReady) {
          return;
        }

        login();
      }}
      type="button"
    >
      <Wallet className="size-4" />
      <span>{isReady ? "Connect Wallet" : "Loading Wallet"}</span>
    </button>
  );
}
