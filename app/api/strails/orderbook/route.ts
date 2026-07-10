import { NextResponse } from "next/server";
import { getStrailsOrderBook, isStrailsConfigured, STRAILS_PAIR } from "@/lib/strails";
import { buildStrailsBook } from "@/lib/strails-orderbook";
import { recordStrailsBookStatus } from "@/lib/strails-status";
import type { StrailsOrderBookPayload } from "@/lib/strails.types";

export const dynamic = "force-dynamic";

function toResponse(payload: StrailsOrderBookPayload) {
  return NextResponse.json(payload, {
    headers: {
      "cache-control": "no-store",
    },
  });
}

export async function GET() {
  const fetchedAt = new Date().toISOString();

  if (!isStrailsConfigured()) {
    recordStrailsBookStatus("unconfigured");
    return toResponse({ asks: [], bids: [], fetchedAt, pair: STRAILS_PAIR, status: "unconfigured" });
  }

  let book: ReturnType<typeof buildStrailsBook>;

  try {
    book = buildStrailsBook(await getStrailsOrderBook());
  } catch (error) {
    recordStrailsBookStatus("upstream_error", error instanceof Error ? error.message : String(error));
    return toResponse({ asks: [], bids: [], fetchedAt, pair: STRAILS_PAIR, status: "upstream_error" });
  }

  const detail =
    book.status === "crossed" || book.status === "implausible"
      ? `best bid ${book.bids[0]?.price ?? "—"}, best ask ${book.asks[0]?.price ?? "—"}`
      : undefined;
  recordStrailsBookStatus(book.status, detail);

  return toResponse({ ...book, fetchedAt, pair: STRAILS_PAIR });
}
