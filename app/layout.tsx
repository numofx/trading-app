import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import Script from "next/script";
import { AppPrivyProvider } from "@/ui/PrivyProvider";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
});

// Not a variable font: the weights the terminal's figures use.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  description: "An orderbook exchange for USDC/cNGN spot.",
  manifest: "/manifest.webmanifest",
  title: "Numo",
  other: {
    "base:app_id": "6a57c26c338fe7f5494ab385",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Synchronous theme hydration to prevent styling flashes before react paints
          dangerouslySetInnerHTML={{
            __html: `(function() { try { var theme = localStorage.getItem('theme'); if (theme === 'light') { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); } else { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); } } catch (e) {} })();`,
          }}
        />
      </head>
      <body className={`${instrumentSans.variable} ${plexMono.variable} antialiased`}>
        {/* Google tag (gtag.js) */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-N6RNENS36P"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-N6RNENS36P');`}
        </Script>
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
