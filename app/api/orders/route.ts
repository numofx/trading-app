import { NextResponse } from "next/server";
import { getMarketsServiceUrl } from "@/lib/markets-service";

export async function POST(request: Request) {
  const payload = await request.json();

  const response = await fetch(`${getMarketsServiceUrl()}/v1/orders`, {
    body: JSON.stringify(payload),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "POST",
  });

  const responseText = await response.text();
  const contentType = response.headers.get("content-type") ?? "application/json";

  return new NextResponse(responseText, {
    headers: {
      "content-type": contentType,
    },
    status: response.status,
  });
}
