import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getStorefrontAnalyticsOverview, recordStorefrontEvent } from "../storefront-analytics.js";

const jsonValueSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
);

const overviewQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).default(30),
});

const createEventBodySchema = z.object({
  event_name: z.enum(["page_view", "view_content", "contact", "initiate_checkout", "purchase"]),
  event_key: z.string().trim().max(160).optional().nullable(),
  received_from: z.enum(["browser", "server"]).default("browser"),
  visitor_id: z.string().trim().max(160).optional().nullable(),
  session_id: z.string().trim().max(160).optional().nullable(),
  source_host: z.string().trim().max(255).optional().nullable(),
  page_url: z.string().trim().max(2000).optional().nullable(),
  page_path: z.string().trim().max(512).optional().nullable(),
  referrer: z.string().trim().max(2000).optional().nullable(),
  utm_source: z.string().trim().max(255).optional().nullable(),
  utm_medium: z.string().trim().max(255).optional().nullable(),
  utm_campaign: z.string().trim().max(255).optional().nullable(),
  utm_term: z.string().trim().max(255).optional().nullable(),
  utm_content: z.string().trim().max(255).optional().nullable(),
  product_id: z.coerce.number().int().positive().optional().nullable(),
  sku: z.string().trim().max(255).optional().nullable(),
  order_id: z.coerce.number().int().positive().optional().nullable(),
  customer_id: z.coerce.number().int().positive().optional().nullable(),
  checkout_intent_id: z.coerce.number().int().positive().optional().nullable(),
  value_amount: z.coerce.number().finite().optional().nullable(),
  currency_code: z.string().trim().max(12).optional().nullable(),
  payload: z.record(z.string(), jsonValueSchema).optional(),
  event_time: z.string().trim().optional().nullable(),
});

export const storefrontAnalyticsApiRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/growth/overview", async (request) => {
    const query = overviewQuerySchema.parse(request.query);
    return getStorefrontAnalyticsOverview(query);
  });

  app.post("/v1/storefront/events", async (request, reply) => {
    const body = createEventBodySchema.parse(request.body);
    const id = await recordStorefrontEvent({
      eventName: body.event_name,
      eventKey: body.event_key,
      receivedFrom: body.received_from,
      visitorId: body.visitor_id,
      sessionId: body.session_id,
      sourceHost: body.source_host,
      pageUrl: body.page_url,
      pagePath: body.page_path,
      referrer: body.referrer,
      utmSource: body.utm_source,
      utmMedium: body.utm_medium,
      utmCampaign: body.utm_campaign,
      utmTerm: body.utm_term,
      utmContent: body.utm_content,
      productId: body.product_id,
      sku: body.sku,
      orderId: body.order_id,
      customerId: body.customer_id,
      checkoutIntentId: body.checkout_intent_id,
      valueAmount: body.value_amount,
      currencyCode: body.currency_code,
      payload: body.payload,
      eventTime: body.event_time,
    });

    return reply.code(201).send({
      ok: true,
      id,
    });
  });
};
