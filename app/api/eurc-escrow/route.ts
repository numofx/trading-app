import { NextResponse } from "next/server";
import type { EurcEscrowResponse } from "@/lib/eurc-deposit-escrow";
import { findSpotMarket } from "@/lib/market-pickers";
import type { MarketPresentation } from "@/lib/markets-service";
import { getMarketsServiceUrl } from "@/lib/markets-service";

/**
 * The venue's EURC-USDC escrow (`asset_address`), read from `/v1/markets` uncached, for the deposit
 * check (lib/eurc-deposit-escrow.ts). `asset_address` is omitted when the venue does not list EURC-USDC;
 * a failed read is a 502 with no address. Either way the deposit is refused, never defaulted.
 */
export async function GET() {
  try {
    const response = await fetch(`${getMarketsServiceUrl()}/v1/markets`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return NextResponse.json({} satisfies EurcEscrowResponse, { status: 502 });
    }
    const eurc = findSpotMarket((await response.json()) as MarketPresentation[], "EURC");
    const body: EurcEscrowResponse = eurc?.asset_address
      ? { asset_address: eurc.asset_address }
      : {};
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({} satisfies EurcEscrowResponse, { status: 502 });
  }
}
