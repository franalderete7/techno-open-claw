import { createHash } from "node:crypto";
import { config } from "./config.js";
import { query } from "./db.js";

type OrderRow = {
  id: number;
  order_number: string;
  customer_id: number | null;
  status: string;
  currency_code: string;
  total_amount: string | number;
  customer_phone: string | null;
  customer_email: string | null;
};

type OrderItemRow = {
  quantity: number;
  sku: string | null;
};

type StoreMetaRow = {
  value: unknown;
};

type MetaConversionResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  response?: unknown;
};

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function normalizePhone(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D+/g, "");
  return digits || null;
}

function sha256(value: string | null | undefined) {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex");
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toText(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

async function getStorefrontUrl() {
  const rows = await query<StoreMetaRow>("select value from public.settings where key = 'store' limit 1");
  const storeRoot = asRecord(rows[0]?.value) ?? {};
  return toText(storeRoot.storefront_url) || toText(storeRoot.store_website_url) || "https://technostoresalta.com";
}

function buildStorefrontProductPath(sku: string) {
  return `/${encodeURIComponent(sku.trim().toLowerCase())}`;
}

function buildEventSourceUrl(storefrontUrl: string, sku: string | null) {
  if (!sku) {
    return storefrontUrl.replace(/\/$/, "");
  }

  return `${storefrontUrl.replace(/\/$/, "")}${buildStorefrontProductPath(sku)}`;
}

export function hasMetaConversionsConfig() {
  return Boolean(config.META_PIXEL_ID.trim() && config.META_ACCESS_TOKEN.trim());
}

export async function sendMetaPurchaseEventForOrder(orderId: number): Promise<MetaConversionResult> {
  if (!hasMetaConversionsConfig()) {
    return {
      ok: false,
      skipped: true,
      reason: "missing_meta_conversions_config",
    };
  }

  const [orderRows, itemRows, storefrontUrl] = await Promise.all([
    query<OrderRow>(
      `
        select
          o.id,
          o.order_number,
          o.customer_id,
          o.status,
          o.currency_code,
          o.total_amount,
          c.phone as customer_phone,
          c.email as customer_email
        from public.orders o
        left join public.customers c on c.id = o.customer_id
        where o.id = $1
        limit 1
      `,
      [orderId]
    ),
    query<OrderItemRow>(
      `
        select
          oi.quantity,
          p.sku
        from public.order_items oi
        left join public.products p on p.id = oi.product_id
        where oi.order_id = $1
        order by oi.id asc
      `,
      [orderId]
    ),
    getStorefrontUrl(),
  ]);

  const order = orderRows[0];

  if (!order) {
    return {
      ok: false,
      skipped: true,
      reason: "order_not_found",
    };
  }

  if (!["paid", "fulfilled"].includes(order.status)) {
    return {
      ok: false,
      skipped: true,
      reason: "order_not_finalized",
    };
  }

  const contents = itemRows
    .filter((item) => item.sku)
    .map((item) => ({
      id: item.sku as string,
      quantity: item.quantity,
    }));

  if (contents.length === 0) {
    return {
      ok: false,
      skipped: true,
      reason: "order_has_no_trackable_items",
    };
  }

  const userData: Record<string, unknown> = {};
  const normalizedPhone = normalizePhone(order.customer_phone);
  const normalizedEmail = normalizeEmail(order.customer_email);

  if (normalizedPhone) {
    userData.ph = [sha256(normalizedPhone)];
  }

  if (normalizedEmail) {
    userData.em = [sha256(normalizedEmail)];
  }

  if (order.customer_id != null) {
    userData.external_id = [sha256(String(order.customer_id))];
  }

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: `order-${order.id}-purchase`,
        action_source: "system_generated",
        event_source_url: buildEventSourceUrl(storefrontUrl, contents[0]?.id ?? null),
        user_data: userData,
        custom_data: {
          currency: order.currency_code,
          value: toNumber(order.total_amount) ?? 0,
          content_type: "product",
          content_ids: contents.map((item) => item.id),
          contents,
          order_id: order.order_number,
        },
      },
    ],
    ...(config.META_TEST_EVENT_CODE.trim() ? { test_event_code: config.META_TEST_EVENT_CODE.trim() } : {}),
  };

  const url = new URL(
    `${config.META_GRAPH_API_BASE.replace(/\/$/, "")}/${config.META_API_VERSION.replace(/^\//, "")}/${config.META_PIXEL_ID.trim()}/events`
  );
  url.searchParams.set("access_token", config.META_ACCESS_TOKEN.trim());

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const rawBody = await response.text();
  const parsedBody = rawBody ? JSON.parse(rawBody) : {};

  if (!response.ok) {
    throw new Error(`Meta Conversions API purchase event failed with ${response.status}`);
  }

  return {
    ok: true,
    response: parsedBody,
  };
}
