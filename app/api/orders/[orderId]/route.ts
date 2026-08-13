import { NextResponse } from "next/server";
import { getMarketsServiceUrl } from "@/lib/markets-service";

/**
 * Reads an order's outcome from markets-service.
 *
 * The submit response only says the venue accepted the order. Whether it filled, is still resting,
 * or expired unfilled is a separate question, and the terminal used to answer it by repeating the
 * limit price back to the trader as though it were a fill.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const response = await fetch(
    `${getMarketsServiceUrl()}/v1/orders/${encodeURIComponent(orderId)}`,
    { cache: "no-store", headers: { accept: "application/json" } }
  );

  const responseText = await response.text();

  return new NextResponse(responseText, {
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    status: response.status,
  });
}
