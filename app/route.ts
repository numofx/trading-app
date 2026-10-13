import { NextResponse } from "next/server";
import { futurePath, marketPath } from "@/lib/market-routes";
import { getFrontMonthFuture } from "@/lib/markets-service";

/** Chosen per request: which future is front-month changes at every roll. */
export const dynamic = "force-dynamic";

/**
 * `/` opens the front-month future: the nearest series `/v1/markets` lists that has not expired,
 * read from the minute-cached market list, so a roll needs no deploy. With no future listed, or
 * the venue unreachable, it opens spot. Temporary (307), query string kept.
 */
export async function GET(request: Request) {
  let destination: string = marketPath("spot");
  try {
    const future = await getFrontMonthFuture();
    if (future !== null) {
      destination = futurePath(future.market);
    }
  } catch {
    // The venue is unreachable: spot's page renders its own empty states.
  }
  const { search } = new URL(request.url);
  return NextResponse.redirect(new URL(`${destination}${search}`, request.url), 307);
}
