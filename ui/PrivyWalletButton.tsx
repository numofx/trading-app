"use client";

import { useLogin, useLogout, usePrivy, useWallets } from "@privy-io/react-auth";
import { Wallet } from "lucide-react";
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
        className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#101926] px-3.5 font-medium text-[#738095] text-[12px] ring-1 ring-white/6"
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
    onError: (error) => {
      if (error === "exited_auth_flow") {
        return;
      }

      console.error("Privy login error", error);
    },
  });
  const { logout } = useLogout();
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
        "inline-flex h-10 items-center gap-2 rounded-2xl px-3.5 font-medium text-[12px] transition-colors",
        authenticated
          ? "bg-[#101F18] text-[#D8F3E4] ring-1 ring-[#1F5C41] hover:bg-[#143224]"
          : "bg-[#19356C] text-[#EEF4FF] hover:bg-[#214180]",
        (!ready || !walletsReady) && "cursor-wait opacity-80",
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
      <Wallet className="size-3.5" />
      <span>{buttonLabel}</span>
    </button>
  );
}
