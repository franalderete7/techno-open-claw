import { NextRequest, NextResponse } from "next/server";

const apiBaseUrl = process.env.INTERNAL_API_BASE_URL || "http://127.0.0.1:4000";
const apiKey = process.env.INTERNAL_API_BEARER_TOKEN || "";

export async function GET(request: NextRequest) {
  try {
    const res = await fetch(`${apiBaseUrl}/v1/settings`, {
      headers: { "x-api-key": apiKey || "" },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch settings" }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
