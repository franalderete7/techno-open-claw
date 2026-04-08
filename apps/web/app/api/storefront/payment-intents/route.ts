import { NextRequest, NextResponse } from "next/server";
import { createStorefrontPaymentIntent } from "../../../../lib/api";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const productId = Number(body.product_id ?? body.productId ?? 0);
  if (!Number.isFinite(productId) || productId <= 0) {
    return NextResponse.json({ error: "invalid_product_id" }, { status: 400 });
  }

  const referer = request.headers.get("referer");
  const refererUrl = referer ? new URL(referer) : null;
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");

  try {
    const result = await createStorefrontPaymentIntent({
      product_id: productId,
      source_host: forwardedHost || refererUrl?.host || null,
      source_path: refererUrl?.pathname || (typeof body.source_path === "string" ? body.source_path : null),
      channel: "storefront",
      delivery_mode: typeof body.delivery_mode === "string" ? body.delivery_mode : null,
      availability_preference: typeof body.availability_preference === "string" ? body.availability_preference : null,
      payment_preference: typeof body.payment_preference === "string" ? body.payment_preference : null,
      customer_city: typeof body.customer_city === "string" ? body.customer_city : null,
      customer_province: typeof body.customer_province === "string" ? body.customer_province : null,
      contact_goal: typeof body.contact_goal === "string" ? body.contact_goal : null,
      source_placement: typeof body.source_placement === "string" ? body.source_placement : null,
      visitor_id: typeof body.visitor_id === "string" ? body.visitor_id : null,
      session_id: typeof body.session_id === "string" ? body.session_id : null,
      page_url: typeof body.page_url === "string" ? body.page_url : referer,
      referrer: typeof body.referrer === "string" ? body.referrer : null,
      utm_source: typeof body.utm_source === "string" ? body.utm_source : null,
      utm_medium: typeof body.utm_medium === "string" ? body.utm_medium : null,
      utm_campaign: typeof body.utm_campaign === "string" ? body.utm_campaign : null,
      utm_term: typeof body.utm_term === "string" ? body.utm_term : null,
      utm_content: typeof body.utm_content === "string" ? body.utm_content : null,
      device_type: typeof body.device_type === "string" ? body.device_type : null,
      device_family: typeof body.device_family === "string" ? body.device_family : null,
      os_name: typeof body.os_name === "string" ? body.os_name : null,
      browser_name: typeof body.browser_name === "string" ? body.browser_name : null,
      user_agent: typeof body.user_agent === "string" ? body.user_agent : request.headers.get("user-agent"),
      screen_width: Number.isFinite(Number(body.screen_width)) ? Number(body.screen_width) : null,
      screen_height: Number.isFinite(Number(body.screen_height)) ? Number(body.screen_height) : null,
      viewport_width: Number.isFinite(Number(body.viewport_width)) ? Number(body.viewport_width) : null,
      viewport_height: Number.isFinite(Number(body.viewport_height)) ? Number(body.viewport_height) : null,
      language: typeof body.language === "string" ? body.language : null,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "storefront_payment_intent_failed",
      },
      { status: 500 }
    );
  }
}
