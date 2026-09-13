import { Duration } from "effect";
import type { OrderHistoryAuthFrame } from "@/lib/order-history.types";

const DEFAULT_MARKETS_AUTH_DOMAIN = "markets.numo.xyz";
const BASE64_PADDING_PATTERN = /=+$/;

/**
 * How long one signature unlocks order history. markets-service accepts frames of up to 24 hours
 * (`ORDER_HISTORY_AUTH_MAX_TTL`); half that leaves room for clock skew and a lowered server limit,
 * and still means one wallet prompt a session rather than one per visit to the tab.
 */
export const ORDER_HISTORY_AUTH_LIFETIME_SECONDS = Duration.toSeconds("12 hours");

/** A cached frame this close to expiry is re-signed rather than sent, so no request lands just after it lapses. */
const EXPIRY_MARGIN_SECONDS = Duration.toSeconds("1 minute");

/**
 * The domain markets-service binds into its signed logins (`WS_AUTH_DOMAIN`). The hosted venue runs
 * the service default; override only together with the service.
 */
export function getMarketsAuthDomain() {
  return process.env.NEXT_PUBLIC_MARKETS_AUTH_DOMAIN?.trim() || DEFAULT_MARKETS_AUTH_DOMAIN;
}

/**
 * The exact message markets-service verifies for order history (`wsauth.Verifier.Message` with
 * `OrderHistoryStatement`). It must match byte-for-byte: any difference recovers a different
 * address, and the request is refused as a signature mismatch.
 */
export function buildOrderHistoryAuthMessage({
  address,
  domain,
  expiry,
  issuedAt,
  nonce,
}: {
  address: string;
  domain: string;
  expiry: number;
  issuedAt: number;
  nonce: string;
}) {
  return [
    `${domain} wants you to view your Numo order history.`,
    `Address: ${address.trim().toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expiry}`,
  ].join("\n");
}

/** An unsigned frame for `address`, valid from `nowSeconds` for {@link ORDER_HISTORY_AUTH_LIFETIME_SECONDS}. */
export function createOrderHistoryAuthDraft({
  address,
  nonce,
  nowSeconds,
}: {
  address: string;
  nonce: string;
  nowSeconds: number;
}) {
  return {
    address: address.trim().toLowerCase(),
    expiry: nowSeconds + ORDER_HISTORY_AUTH_LIFETIME_SECONDS,
    issued_at: nowSeconds,
    nonce,
  };
}

/** The `X-Numo-Auth` header value: the frame as unpadded base64url JSON. */
export function encodeOrderHistoryAuthHeader(frame: OrderHistoryAuthFrame) {
  let binary = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(frame))) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(BASE64_PADDING_PATTERN, "");
}

/** Whether a cached frame can still authorize requests for `address`. */
export function isOrderHistoryAuthUsable(
  frame: OrderHistoryAuthFrame | null,
  address: string | null,
  nowSeconds: number
) {
  if (frame === null || address === null) {
    return false;
  }
  return (
    frame.address === address.trim().toLowerCase() &&
    frame.expiry - EXPIRY_MARGIN_SECONDS > nowSeconds
  );
}

/** Parses a stored frame, returning null for anything malformed rather than throwing. */
export function parseOrderHistoryAuthFrame(raw: string | null): OrderHistoryAuthFrame | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (
      parsed === null ||
      typeof parsed.address !== "string" ||
      typeof parsed.signature !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.issued_at !== "number" ||
      typeof parsed.expiry !== "number"
    ) {
      return null;
    }
    return {
      address: parsed.address,
      expiry: parsed.expiry,
      issued_at: parsed.issued_at,
      nonce: parsed.nonce,
      signature: parsed.signature,
    };
  } catch {
    return null;
  }
}
