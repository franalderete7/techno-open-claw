import { NextRequest, NextResponse } from "next/server";

const apiBaseUrl = process.env.INTERNAL_API_BASE_URL || "http://127.0.0.1:4000";
const apiKey = process.env.INTERNAL_API_BEARER_TOKEN || "";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const limit = url.searchParams.get("limit") || "50";
  const channel = url.searchParams.get("channel");

  try {
    const params = new URLSearchParams();
    params.set("limit", limit);
    if (channel) params.set("channel", channel);

    const res = await fetch(`${apiBaseUrl}/v1/customers?${params.toString()}`, {
      headers: { "x-api-key": apiKey || "" },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch customers" }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch customers:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
