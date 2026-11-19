import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getMarketsServiceUrl } from "@/lib/markets-service";

/** A wallet's BookCustodian accounts (`GET /custodian/accounts`), each confirmed on chain by markets-service. */
export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isAddress(wallet)) {
    return NextResponse.json(
      { error: "wallet must be an address" },
      { headers: { "cache-control": "no-store" }, status: 400 }
    );
  }
  const response = await fetch(
    `${getMarketsServiceUrl()}/custodian/accounts?wallet=${encodeURIComponent(wallet)}`,
    { cache: "no-store", headers: { accept: "application/json" } }
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}
