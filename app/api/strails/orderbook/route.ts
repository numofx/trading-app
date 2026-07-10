import { NextResponse } from "next/server";
import { getStrailsOrderBook, isStrailsConfigured, STRAILS_PAIR } from "@/lib/strails";
import { buildStrailsBook } from "@/lib/strails-orderbook";
import { recordStrailsBookStatus } from "@/lib/strails-status";
import type { StrailsOrderBookPayload } from "@/lib/strails.types";

export const dynamic = "force-dynamic";

function toErrorDetail(error: unknown) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  // undici reports network failures as "fetch failed" with the real reason in `cause`.
  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : "";
  return `${error.message}${cause}`;
}

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
    // Safe to expose: messages here are our own thrown errors (HTTP status) or
    // fetch/timeout errors — never credentials or upstream payloads.
    const detail = toErrorDetail(error);
    recordStrailsBookStatus("upstream_error", detail);
    return toResponse({ asks: [], bids: [], detail, fetchedAt, pair: STRAILS_PAIR, status: "upstream_error" });
  }

  const detail =
    book.status === "crossed" || book.status === "implausible"
      ? `best bid ${book.bids[0]?.price ?? "—"}, best ask ${book.asks[0]?.price ?? "—"}`
      : undefined;
  recordStrailsBookStatus(book.status, detail);

  return toResponse({ ...book, detail, fetchedAt, pair: STRAILS_PAIR });
}
