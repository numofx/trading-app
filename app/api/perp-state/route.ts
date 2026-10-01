import { NextResponse } from "next/server";
import { getMarketsServiceUrl } from "@/lib/markets-service";
import type { PerpStatePresentation } from "@/lib/perp-market";

type MarketRow = { contract_type?: string; asset_address?: string; perp?: PerpStatePresentation };

/**
 * USDCcNGN-PERP's chain state as markets-service serves it right now (`/v1/markets`, the perp
 * entry's `perp` block), for the terminal to re-read while open. The page renders with a listing
 * cached up to a minute; `trading_enabled` flipping at launch or on a guardian pause must not wait
 * for a reload. Never cached: the point is the current answer.
 */
export async function GET() {
  const response = await fetch(`${getMarketsServiceUrl()}/v1/markets`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    return NextResponse.json(
      { error: `markets-service returned ${response.status}` },
      { headers: { "cache-control": "no-store" }, status: 502 }
    );
  }
  const markets = (await response.json()) as MarketRow[];
  const perp = markets.find((market) => market.contract_type === "perpetual");
  return NextResponse.json(
    { asset_address: perp?.asset_address ?? null, perp: perp?.perp ?? null },
    { headers: { "cache-control": "no-store" } }
  );
}
