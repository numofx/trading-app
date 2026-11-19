import { NextResponse } from "next/server";
import { getMarketsServiceUrl } from "@/lib/markets-service";

const SYMBOL_PATTERN = /^[A-Za-z0-9-]{1,32}$/;

/**
 * What a take on a future's onchain book would fill now (`GET /book-depth`): each side's fill and average price at
 * a ladder of sizes, read from the book itself. The venue caches it for 5 seconds; so does this.
 */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
  if (!SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }
  const response = await fetch(
    `${getMarketsServiceUrl()}/book-depth?symbol=${encodeURIComponent(symbol)}`,
    { headers: { accept: "application/json" }, next: { revalidate: 5 } }
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: {
      "cache-control": "public, max-age=5",
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}
