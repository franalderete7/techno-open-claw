import { NextRequest, NextResponse } from "next/server";
import { createStorefrontEvent } from "../../../../lib/api";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const eventName = typeof body.event_name === "string" ? body.event_name : null;
  if (!eventName) {
    return NextResponse.json({ error: "missing_event_name" }, { status: 400 });
  }

  const referer = request.headers.get("referer");
  const refererUrl = referer ? new URL(referer) : null;
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");

  try {
    const result = await createStorefrontEvent({
      event_name: eventName as "page_view" | "search" | "view_content" | "contact" | "initiate_checkout" | "purchase",
      event_key: typeof body.event_key === "string" ? body.event_key : null,
      received_from: typeof body.received_from === "string" ? (body.received_from as "browser" | "server") : "browser",
      visitor_id: typeof body.visitor_id === "string" ? body.visitor_id : null,
      session_id: typeof body.session_id === "string" ? body.session_id : null,
      source_host: forwardedHost || (typeof body.source_host === "string" ? body.source_host : null) || refererUrl?.host || null,
      page_url: typeof body.page_url === "string" ? body.page_url : null,
      page_path: typeof body.page_path === "string" ? body.page_path : refererUrl?.pathname || null,
      referrer: typeof body.referrer === "string" ? body.referrer : referer,
      utm_source: typeof body.utm_source === "string" ? body.utm_source : null,
      utm_medium: typeof body.utm_medium === "string" ? body.utm_medium : null,
      utm_campaign: typeof body.utm_campaign === "string" ? body.utm_campaign : null,
      utm_term: typeof body.utm_term === "string" ? body.utm_term : null,
      utm_content: typeof body.utm_content === "string" ? body.utm_content : null,
      product_id: Number.isFinite(Number(body.product_id)) ? Number(body.product_id) : null,
      sku: typeof body.sku === "string" ? body.sku : null,
      order_id: Number.isFinite(Number(body.order_id)) ? Number(body.order_id) : null,
      customer_id: Number.isFinite(Number(body.customer_id)) ? Number(body.customer_id) : null,
      checkout_intent_id: Number.isFinite(Number(body.checkout_intent_id)) ? Number(body.checkout_intent_id) : null,
      value_amount: Number.isFinite(Number(body.value_amount)) ? Number(body.value_amount) : null,
      currency_code: typeof body.currency_code === "string" ? body.currency_code : null,
      payload: body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? (body.payload as Record<string, unknown>) : undefined,
      event_time: typeof body.event_time === "string" ? body.event_time : null,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "storefront_event_create_failed",
      },
      { status: 500 }
    );
  }
}
