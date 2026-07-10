import "server-only";

import { Duration } from "effect";
import type { StrailsOrderBookData } from "@/lib/strails.types";

export const STRAILS_PAIR = "CNGN-USDC";

const REQUEST_TIMEOUT_MS = Duration.toMillis("5 seconds");
const BOOK_DEPTH_LIMIT = 50;
const TRAILING_SLASHES_PATTERN = /\/+$/;

/**
 * Strails authenticates with an x-api-key header plus server IP allowlisting, so the
 * key must never reach the client and all calls go through this server-only module.
 */
function getStrailsConfig() {
  const apiUrl = process.env.STRAILS_API_URL?.trim();
  const apiKey = process.env.STRAILS_API_KEY?.trim();

  if (!apiUrl || !apiKey) {
    return null;
  }

  return { apiKey, apiUrl: apiUrl.replace(TRAILING_SLASHES_PATTERN, "") };
}

export function isStrailsConfigured() {
  return getStrailsConfig() !== null;
}

export async function getStrailsOrderBook(): Promise<StrailsOrderBookData> {
  const config = getStrailsConfig();

  if (!config) {
    throw new Error("strails is not configured: set STRAILS_API_URL and STRAILS_API_KEY");
  }

  const response = await fetch(
    `${config.apiUrl}/fx/orderbook?pair=${STRAILS_PAIR}&limit=${BOOK_DEPTH_LIMIT}`,
    {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-api-key": config.apiKey,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  );

  if (!response.ok) {
    // Strails returns JSON validation messages on errors; include a snippet for
    // diagnostics (no credentials ever appear in these bodies).
    const body = (await response.text().catch(() => "")).slice(0, 160);
    throw new Error(`strails orderbook returned ${response.status}${body ? `: ${body}` : ""}`);
  }

  const payload = (await response.json()) as { data?: StrailsOrderBookData };
  return payload.data ?? {};
}
