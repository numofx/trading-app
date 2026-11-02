import { NextResponse } from "next/server";
import { loadOptionSeries } from "@/lib/option-chain-read";

/**
 * The options page's chain: a series' strikes with the engine's marks and the book's best prices. Never cached:
 * the page polls it, and quotes move every few seconds. A series the venue does not list has no chain.
 */
export async function GET(request: Request) {
  const series = new URL(request.url).searchParams.get("series")?.trim() ?? "";
  if (series === "") {
    return NextResponse.json({ error: "series is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await loadOptionSeries(series, Date.now()), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "the venue could not be read" }, { status: 502 });
  }
}
