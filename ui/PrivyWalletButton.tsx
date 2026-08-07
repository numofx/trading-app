"use client";

import { useLogin, useLogout, usePrivy, useWallets } from "@privy-io/react-auth";
import { Wallet } from "lucide-react";
import posthog from "posthog-js";
import { cn } from "@/lib/cn";

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function PrivyWalletButton() {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();

  if (!privyAppId) {
    return (
      <button
        aria-disabled="true"
        className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-white px-4 font-medium text-[#111111] text-[13px] ring-1 ring-black/10"
        title="Set NEXT_PUBLIC_PRIVY_APP_ID to enable wallet login"
        type="button"
      >
        <Wallet className="size-3.5" />
        <span>Wallet Unconfigured</span>
      </button>
    );
  }

  return <PrivyWalletButtonInner />;
}

function PrivyWalletButtonInner() {
  const { authenticated, ready } = usePrivy();
  const { login } = useLogin({
    onComplete: ({ user, loginAccount }) => {
      const walletAddress =
        loginAccount && "address" in loginAccount ? (loginAccount.address as string) : null;
      const distinctId = walletAddress ?? user.id;
      posthog.identify(distinctId);
      posthog.capture("wallet_connected", {
        wallet_address_truncated: walletAddress
          ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
          : null,
        login_method: loginAccount?.type ?? null,
        privy_user_id: user.id,
        is_new_user: false,
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
  const walletAddress = primaryWallet?.address ? formatAddress(primaryWallet.address) : null;
  let buttonLabel = "Connect Wallet";

  if (!ready || !walletsReady) {
    buttonLabel = "Loading Wallet";
  } else if (authenticated) {
    buttonLabel = walletAddress ?? "Wallet Connected";
  }

  return (
    <button
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-[10px] px-4 font-medium text-[13px] transition-colors",
        authenticated
          ? "bg-white text-[#111111] ring-1 ring-black/10 hover:bg-white/90"
          : "bg-white text-[#111111] ring-1 ring-black/10 hover:bg-white/90",
        (!ready || !walletsReady) && "cursor-wait opacity-80"
      )}
      onClick={() => {
        if (!ready || !walletsReady) {
          return;
        }

        if (authenticated) {
          void logout();
          return;
        }

        login();
      }}
      type="button"
    >
      <Wallet className="size-4" />
      <span>{buttonLabel}</span>
    </button>
  );
}
