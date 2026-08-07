import { NextResponse } from "next/server";
import { Duration } from "effect";

export const dynamic = "force-dynamic";

const REQUEST_TIMEOUT_MS = Duration.toMillis("5 seconds");

/**
 * Reports this deployment's current egress IP. Strails enforces an IP allowlist
 * server-side, so ops can hit this route to learn which IP must be registered
 * via strails' /manageipallowlist when the platform's egress changes.
 */
export async function GET() {
  try {
    const response = await fetch("https://api.ipify.org?format=json", {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = (await response.json()) as { ip?: string };
    return NextResponse.json({ egressIp: payload.ip ?? null, fetchedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json(
      { egressIp: null, fetchedAt: new Date().toISOString() },
      { status: 502 }
    );
  }
}
