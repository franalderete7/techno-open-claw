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
      visitor_id: typeof body.visitor_id === "string" ? body.visitor_id : null,
      session_id: typeof body.session_id === "string" ? body.session_id : null,
      page_url: typeof body.page_url === "string" ? body.page_url : referer,
      referrer: typeof body.referrer === "string" ? body.referrer : null,
      utm_source: typeof body.utm_source === "string" ? body.utm_source : null,
      utm_medium: typeof body.utm_medium === "string" ? body.utm_medium : null,
      utm_campaign: typeof body.utm_campaign === "string" ? body.utm_campaign : null,
      utm_term: typeof body.utm_term === "string" ? body.utm_term : null,
      utm_content: typeof body.utm_content === "string" ? body.utm_content : null,
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
