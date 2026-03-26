"use client";

import { PrivyProvider } from "@privy-io/react-auth";

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

  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId || undefined}
      config={{
        appearance: {
          accentColor: "#19356C",
          logo: "/numo_logo_white.png",
          theme: "dark",
        },
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
