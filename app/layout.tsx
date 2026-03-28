import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { AppPrivyProvider } from "@/ui/PrivyProvider";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  description: "A dark trading terminal interface mockup built with Next.js.",
  manifest: "/manifest.webmanifest",
  other: {
    "base:app_id": "69c83c9c4e918ceaf56a8408",
  },
  title: "Trading Terminal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AppPrivyProvider>{children}</AppPrivyProvider>
        {process.env.NODE_ENV === "development" ? (
          <Script
            crossOrigin="anonymous"
            src="https://unpkg.com/react-grab/dist/index.global.js"
            strategy="lazyOnload"
          />
        ) : null}
      </body>
    </html>
  );
}
