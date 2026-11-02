import { NextResponse } from "next/server";
import { loadOptionBook } from "@/lib/option-chain-read";

/** One option strike's book and trades, for the options page's panel. Never cached: the page polls it. */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim() ?? "";
  if (symbol === "") {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }
  try {
    const book = await loadOptionBook(symbol);
    return book === null
      ? NextResponse.json({ error: "no such option" }, { status: 404 })
      : NextResponse.json(book, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "the venue could not be read" }, { status: 502 });
  }
}
