import { NextResponse } from "next/server";
import { getMarketsServiceUrl } from "@/lib/markets-service";

/** Paging params forwarded to markets-service; anything else on the request is dropped. */
const FILLS_PARAMS = ["limit", "before"] as const;

/**
 * Lists the fills on the signed-in wallet's orders (`GET /v1/fills`).
 *
 * The browser signs the login — the same one order history uses; this only forwards its
 * `X-Numo-Auth` header and the paging params. Never cached on either side — the response is one
 * owner's private trade history.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of FILLS_PARAMS) {
    const value = searchParams.get(key);
    if (value) {
      query.set(key, value);
    }
  }

  const auth = request.headers.get("x-numo-auth");
  const queryString = query.toString();
  const response = await fetch(
    `${getMarketsServiceUrl()}/v1/fills${queryString === "" ? "" : `?${queryString}`}`,
    {
      cache: "no-store",
      headers: { accept: "application/json", ...(auth === null ? {} : { "x-numo-auth": auth }) },
    }
  );

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}
