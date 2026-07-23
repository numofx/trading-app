"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { getAppChain } from "@/lib/base-public-client";

export function AppPrivyProvider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim();

  if (!appId) {
    return children;
  }

  // Pin Privy to the app's configured chain (Base mainnet in prod) so it doesn't
  // fall back to its default (Base Sepolia) and prompt a network switch on every
  // deposit/order. Driven by NEXT_PUBLIC_MATCHING_CHAIN_ID via getAppChain().
  const appChain = getAppChain();

  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId || undefined}
      config={{
        appearance: {
          accentColor: "#38bdf8",
          logo: "/numo_logo_white.png",
          theme: "dark",
        },
        defaultChain: appChain,
        supportedChains: [appChain],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
          showWalletUIs: false,
        },
        loginMethods: ["email", "wallet"],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
