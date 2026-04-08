import { NextRequest, NextResponse } from "next/server";

const DATAFAST_EVENTS_URL = "https://datafa.st/api/events";

function getClientIp(request: NextRequest) {
  const directHeaders = ["x-real-ip", "cf-connecting-ip", "fly-client-ip", "x-client-ip"];

  for (const headerName of directHeaders) {
    const value = request.headers.get(headerName)?.trim();
    if (value) {
      return value;
    }
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstHop = forwardedFor
      .split(",")
      .map((part) => part.trim())
      .find(Boolean);

    if (firstHop) {
      return firstHop;
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const clientIp = getClientIp(request);

    const upstreamHeaders = new Headers();
    upstreamHeaders.set("content-type", request.headers.get("content-type") ?? "application/json");

    const userAgent = request.headers.get("user-agent");
    if (userAgent) {
      upstreamHeaders.set("user-agent", userAgent);
    }

    const referer = request.headers.get("referer");
    if (referer) {
      upstreamHeaders.set("referer", referer);
    }

    if (clientIp) {
      upstreamHeaders.set("x-datafast-real-ip", clientIp);
    }

    const response = await fetch(DATAFAST_EVENTS_URL, {
      method: "POST",
      headers: upstreamHeaders,
      body,
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({ ok: false }, { status: 202 });
    }

    const responseBody = await response.text();

    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 202 });
  }
}
