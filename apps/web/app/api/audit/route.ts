import { NextRequest, NextResponse } from "next/server";

const apiBaseUrl = process.env.INTERNAL_API_BASE_URL || "http://127.0.0.1:4000";
const apiKey = process.env.INTERNAL_API_BEARER_TOKEN || "";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const limit = url.searchParams.get("limit") || "100";
  const actor_type = url.searchParams.get("actor_type");
  const entity_type = url.searchParams.get("entity_type");

  try {
    const params = new URLSearchParams();
    params.set("limit", limit);
    if (actor_type) params.set("actor_type", actor_type);
    if (entity_type) params.set("entity_type", entity_type);

    const res = await fetch(`${apiBaseUrl}/v1/audit?${params.toString()}`, {
      headers: { "x-api-key": apiKey || "" },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch audit logs" }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch audit logs:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
