import type { PoolClient, QueryResultRow } from "pg";
import { pool, query } from "./db.js";

type JsonRecord = Record<string, unknown>;
type SqlExecutor = Pick<PoolClient, "query"> | typeof pool;

export type StorefrontEventName = "page_view" | "search" | "view_content" | "contact" | "initiate_checkout" | "purchase";
export type StorefrontEventSource = "browser" | "server";

export type RecordStorefrontEventInput = {
  eventName: StorefrontEventName;
  eventKey?: string | null;
  receivedFrom?: StorefrontEventSource;
  visitorId?: string | null;
  sessionId?: string | null;
  sourceHost?: string | null;
  pageUrl?: string | null;
  pagePath?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  productId?: number | null;
  sku?: string | null;
  orderId?: number | null;
  customerId?: number | null;
  checkoutIntentId?: number | null;
  valueAmount?: number | null;
  currencyCode?: string | null;
  payload?: JsonRecord;
  eventTime?: string | Date | null;
};

export type StorefrontPurchaseEventResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
};

export type StorefrontAnalyticsOverviewOptions = {
  days?: number;
  source?: string | null;
  device?: string | null;
  interval?: "day" | "week" | "month" | null;
};

type PurchaseContextRow = QueryResultRow & {
  order_id: number;
  order_number: string;
  order_status: string;
  order_currency_code: string;
  total_amount: string | number;
  customer_id: number | null;
  customer_phone: string | null;
  customer_email: string | null;
  product_id: number | null;
  sku: string | null;
  checkout_intent_id: number | null;
  source_host: string | null;
  checkout_metadata: unknown;
};

type AnalyticsEventRow = QueryResultRow & {
  id: number;
  event_name: StorefrontEventName;
  received_from: StorefrontEventSource;
  visitor_id: string | null;
  session_id: string | null;
  source_host: string | null;
  page_url: string | null;
  page_path: string | null;
  referrer: string | null;
  referrer_host: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  product_id: number | null;
  order_id: number | null;
  customer_id: number | null;
  checkout_intent_id: number | null;
  currency_code: string | null;
  value_amount: string | number | null;
  payload: JsonRecord | null;
  event_time: string;
  product_sku: string | null;
  product_title: string | null;
  product_brand: string | null;
  order_number: string | null;
  order_status: string | null;
  order_total_amount: string | number | null;
  order_currency_code: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
};

export type StorefrontAnalyticsOverview = {
  generated_at: string;
  window_days: number;
  filters: {
    applied: {
      source: string | null;
      device: string | null;
      interval: "day" | "week" | "month";
    };
    available: {
      sources: string[];
      devices: string[];
      intervals: Array<"day" | "week" | "month">;
    };
  };
  warnings: string[];
  totals: {
    events: number;
    visitors: number;
    sessions: number;
    page_views: number;
    searches: number;
    view_contents: number;
    contacts: number;
    checkout_starts: number;
    purchases: number;
    revenue_ars: number;
    contact_rate_pct: number | null;
    checkout_rate_pct: number | null;
    purchase_rate_pct: number | null;
    avg_session_duration_seconds: number | null;
  };
  journey: Array<{
    key: "sessions" | "view_content" | "engaged" | "purchase";
    label: string;
    detail: string;
    count: number;
    conversion_from_previous_pct: number | null;
    conversion_from_sessions_pct: number | null;
  }>;
  daily: Array<{
    date: string;
    label: string;
    page_views: number;
    searches: number;
    view_contents: number;
    contacts: number;
    checkout_starts: number;
    purchases: number;
    revenue_ars: number;
  }>;
  sources: Array<{
    source: string;
    sessions: number;
    visitors: number;
    page_views: number;
    searches: number;
    view_contents: number;
    contacts: number;
    checkout_starts: number;
    purchases: number;
    revenue_ars: number;
    top_campaign: string | null;
    landing_page: string | null;
  }>;
  landing_pages: Array<{
    path: string;
    sessions: number;
    visitors: number;
    page_views: number;
    view_contents: number;
    contacts: number;
    checkout_starts: number;
    purchases: number;
    revenue_ars: number;
  }>;
  devices: Array<{
    device_family: string;
    device_type: string;
    os_name: string | null;
    browser_name: string | null;
    sessions: number;
    visitors: number;
    searches: number;
    view_contents: number;
    contacts: number;
    checkout_starts: number;
    purchases: number;
    revenue_ars: number;
  }>;
  searches: Array<{
    query: string;
    searches: number;
    visitors: number;
    sessions: number;
    avg_results_count: number | null;
    top_source: string | null;
    top_device: string | null;
  }>;
  products: Array<{
    product_id: number | null;
    sku: string | null;
    url_path: string | null;
    title: string;
    brand: string | null;
    view_contents: number;
    contacts: number;
    checkout_starts: number;
    purchases: number;
    revenue_ars: number;
    last_seen: string | null;
  }>;
  people: Array<{
    visitor_id: string;
    label: string;
    first_seen: string;
    last_seen: string;
    source: string;
    landing_page: string | null;
    sessions: number;
    page_views: number;
    view_contents: number;
    contacts: number;
    checkout_starts: number;
    purchases: number;
    revenue_ars: number;
    last_product: string | null;
    identified_customer: string | null;
    phone: string | null;
    email: string | null;
    device_family: string | null;
    device_type: string | null;
    os_name: string | null;
    browser_name: string | null;
    avg_session_duration_seconds: number | null;
  }>;
  recent_events: Array<{
    id: number;
    event_name: StorefrontEventName;
    received_from: StorefrontEventSource;
    at: string;
    source: string;
    campaign: string | null;
    page_path: string | null;
    product: string | null;
    search_query: string | null;
    device_family: string | null;
    visitor: string | null;
    person: string | null;
    order_number: string | null;
    value_amount: number | null;
    currency_code: string | null;
  }>;
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function trimText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function toNumber(value: string | number | null | undefined) {
  const numeric = Number(value ?? NaN);
  return Number.isFinite(numeric) ? numeric : null;
}

function payloadString(payload: JsonRecord | null | undefined, key: string) {
  return trimText(typeof payload?.[key] === "string" ? (payload[key] as string) : null);
}

function payloadNumber(payload: JsonRecord | null | undefined, key: string) {
  return toNumber(typeof payload?.[key] === "number" || typeof payload?.[key] === "string" ? (payload[key] as string | number) : null);
}

function sessionDurationSeconds(firstSeen: string, lastSeen: string) {
  const start = new Date(firstSeen).getTime();
  const end = new Date(lastSeen).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }

  return Math.max(0, Math.round((end - start) / 1000));
}

function normalizeUrl(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;

  try {
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

function normalizePath(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;

  if (normalized.startsWith("/")) {
    return normalized;
  }

  try {
    return new URL(normalized).pathname || "/";
  } catch {
    return normalized.startsWith("?") ? "/" : `/${normalized.replace(/^\/+/, "")}`;
  }
}

function hostFromUrl(value: string | null | undefined) {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;

  try {
    return new URL(normalized).host || null;
  } catch {
    return null;
  }
}

function parseUtms(pageUrl: string | null) {
  const normalized = normalizeUrl(pageUrl);

  if (!normalized) {
    return {
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    };
  }

  const url = new URL(normalized);

  return {
    utmSource: trimText(url.searchParams.get("utm_source")),
    utmMedium: trimText(url.searchParams.get("utm_medium")),
    utmCampaign: trimText(url.searchParams.get("utm_campaign")),
    utmTerm: trimText(url.searchParams.get("utm_term")),
    utmContent: trimText(url.searchParams.get("utm_content")),
  };
}

function normalizeFilterKey(value: string | null | undefined) {
  return trimText(value)?.toLowerCase() ?? null;
}

function normalizeHost(value: string | null | undefined) {
  const normalized = trimText(value)?.toLowerCase().replace(/^www\./, "");
  return normalized || null;
}

function isUnknownish(value: string | null | undefined) {
  const normalized = normalizeFilterKey(value);
  return !normalized || normalized === "unknown" || normalized === "other" || normalized === "desktop web";
}

function canonicalBrowserName(value: string | null | undefined, userAgent: string | null | undefined) {
  const normalized = normalizeFilterKey(value);
  if (normalized === "chrome") return "Chrome";
  if (normalized === "safari") return "Safari";
  if (normalized === "firefox") return "Firefox";
  if (normalized === "edge") return "Edge";
  if (normalized === "opera") return "Opera";

  const ua = normalizeFilterKey(userAgent);
  if (!ua) return null;
  if (ua.includes("edg/")) return "Edge";
  if (ua.includes("opr/")) return "Opera";
  if (ua.includes("firefox/")) return "Firefox";
  if (ua.includes("chrome/") && !ua.includes("edg/") && !ua.includes("opr/")) return "Chrome";
  if (ua.includes("safari/") && !ua.includes("chrome/")) return "Safari";
  return null;
}

function canonicalOsName(value: string | null | undefined, userAgent: string | null | undefined) {
  const normalized = normalizeFilterKey(value);
  if (normalized === "ios") return "iOS";
  if (normalized === "android") return "Android";
  if (normalized === "macos" || normalized === "mac os") return "macOS";
  if (normalized === "windows") return "Windows";
  if (normalized === "linux") return "Linux";

  const ua = normalizeFilterKey(userAgent);
  if (!ua) return null;
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("cpu iphone os") || ua.includes("cpu os")) return "iOS";
  if (ua.includes("android")) return "Android";
  if (ua.includes("mac os x") || ua.includes("macintosh")) return "macOS";
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("linux")) return "Linux";
  return null;
}

function inferDeviceTypeFromDimensions(viewportWidth: number | null | undefined, screenWidth: number | null | undefined) {
  const candidates = [viewportWidth, screenWidth].filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  if (candidates.length === 0) {
    return null;
  }

  const width = Math.max(...candidates);
  if (width <= 820) return "mobile";
  if (width <= 1180) return "tablet";
  return "desktop";
}

function canonicalDeviceType(
  value: string | null | undefined,
  userAgent: string | null | undefined,
  osName: string | null | undefined,
  viewportWidth?: number | null,
  screenWidth?: number | null
) {
  const normalized = normalizeFilterKey(value);
  if (normalized === "mobile" || normalized === "tablet" || normalized === "desktop") {
    return normalized;
  }

  const ua = normalizeFilterKey(userAgent);
  if (ua?.includes("ipad") || ua?.includes("tablet")) return "tablet";
  if (ua?.includes("iphone") || ua?.includes("ipod") || ua?.includes("android") || ua?.includes("mobile")) return "mobile";

  const os = normalizeFilterKey(osName);
  if (os === "ios" || os === "android") return "mobile";
  if (os === "macos" || os === "windows" || os === "linux") return "desktop";
  const inferredFromDimensions = inferDeviceTypeFromDimensions(viewportWidth, screenWidth);
  if (inferredFromDimensions) return inferredFromDimensions;
  return "unknown";
}

function canonicalDeviceFamily({
  deviceFamily,
  deviceType,
  osName,
  userAgent,
  viewportWidth,
  screenWidth,
}: {
  deviceFamily: string | null | undefined;
  deviceType: string | null | undefined;
  osName: string | null | undefined;
  userAgent: string | null | undefined;
  viewportWidth?: number | null | undefined;
  screenWidth?: number | null | undefined;
}) {
  const normalized = normalizeFilterKey(deviceFamily);
  if (normalized === "iphone") return "iPhone";
  if (normalized === "ipad") return "iPad";
  if (normalized === "android" || normalized === "android phone") return "Android";
  if (normalized === "mac") return "Mac";
  if (normalized === "windows") return "Windows";
  if (normalized === "linux") return "Linux";

  const ua = normalizeFilterKey(userAgent);
  if (ua?.includes("iphone") || ua?.includes("ipod")) return "iPhone";
  if (ua?.includes("ipad")) return "iPad";
  if (ua?.includes("android")) return "Android";
  if (ua?.includes("macintosh") || ua?.includes("mac os x")) return "Mac";
  if (ua?.includes("windows")) return "Windows";
  if (ua?.includes("linux")) return "Linux";

  const os = canonicalOsName(osName, userAgent);
  if (os === "iOS") return normalizeFilterKey(deviceType) === "tablet" ? "iPad" : "iPhone";
  if (os === "Android") return "Android";
  if (os === "macOS") return "Mac";
  if (os === "Windows") return "Windows";
  if (os === "Linux") return "Linux";

  const fallbackType = canonicalDeviceType(deviceType, userAgent, osName, viewportWidth, screenWidth);
  if (fallbackType === "desktop") return "Desktop web";
  if (fallbackType === "mobile") return "Mobile web";
  if (fallbackType === "tablet") return "Tablet web";
  return "Unknown";
}

function preferValue(current: string | null | undefined, next: string | null | undefined) {
  const normalizedNext = trimText(next);
  if (!normalizedNext) return trimText(current);
  if (isUnknownish(current) && !isUnknownish(normalizedNext)) return normalizedNext;
  return trimText(current) || normalizedNext;
}

function deriveDeviceContext(payload: JsonRecord | null | undefined) {
  const userAgent = payloadString(payload, "user_agent");
  const osName = canonicalOsName(payloadString(payload, "os_name"), userAgent);
  const browserName = canonicalBrowserName(payloadString(payload, "browser_name"), userAgent);
  const viewportWidth = payloadNumber(payload, "viewport_width");
  const screenWidth = payloadNumber(payload, "screen_width");
  const deviceType = canonicalDeviceType(payloadString(payload, "device_type"), userAgent, osName, viewportWidth, screenWidth);
  const deviceFamily = canonicalDeviceFamily({
    deviceFamily: payloadString(payload, "device_family"),
    deviceType,
    osName,
    userAgent,
    viewportWidth,
    screenWidth,
  });

  return {
    deviceFamily,
    deviceType,
    osName: osName ?? null,
    browserName: browserName ?? null,
  };
}

function isInternalHost(referrerHost: string | null | undefined, sourceHost: string | null | undefined) {
  const referrer = normalizeHost(referrerHost);
  const source = normalizeHost(sourceHost);
  if (!referrer || !source) return false;
  return referrer === source || referrer.endsWith(`.${source}`) || source.endsWith(`.${referrer}`);
}

function normalizeSearchText(value: string | null | undefined) {
  return trimText(value)?.replace(/\s+/g, " ").toLowerCase() ?? null;
}

const ALLOWED_SHORT_SEARCH_TERMS = new Set([
  "a17",
  "a36",
  "a56",
  "a57",
  "apple",
  "f7",
  "f8",
  "g56",
  "g60",
  "g86",
  "ipad",
  "iphone",
  "jbl",
  "m11",
  "moto",
  "poco",
  "redmi",
  "s25",
  "s26",
  "xiaomi",
]);

function isMeaningfulSearchQuery(value: string | null | undefined) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return false;
  if (normalized.length < 3) return false;

  if (/^[a-z]+$/.test(normalized) && normalized.length < 6 && !ALLOWED_SHORT_SEARCH_TERMS.has(normalized)) {
    return false;
  }

  return true;
}

function isLowSignalLandingPath(value: string | null | undefined) {
  const normalized = trimText(value);
  return !normalized || normalized === "/" || normalized === "(unknown)";
}

type TimeBucketInterval = "day" | "week" | "month";

function normalizeTimeBucketInterval(value: string | null | undefined): TimeBucketInterval {
  const normalized = normalizeFilterKey(value);
  if (normalized === "week") return "week";
  if (normalized === "month") return "month";
  return "day";
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeek(date: Date) {
  const dayStart = startOfUtcDay(date);
  const day = dayStart.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  dayStart.setUTCDate(dayStart.getUTCDate() + diff);
  return dayStart;
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function bucketStartForDate(date: Date, interval: TimeBucketInterval) {
  if (interval === "week") return startOfUtcWeek(date);
  if (interval === "month") return startOfUtcMonth(date);
  return startOfUtcDay(date);
}

function addBucket(date: Date, interval: TimeBucketInterval) {
  const next = new Date(date);
  if (interval === "week") {
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  if (interval === "month") {
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function formatBucketLabel(date: Date, interval: TimeBucketInterval) {
  if (interval === "month") {
    return date.toLocaleDateString("es-AR", { month: "short", year: "2-digit", timeZone: "UTC" });
  }

  if (interval === "week") {
    const weekEnd = new Date(date);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    return `${date.toLocaleDateString("es-AR", { month: "short", day: "numeric", timeZone: "UTC" })}–${weekEnd.toLocaleDateString("es-AR", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    })}`;
  }

  return date.toLocaleDateString("es-AR", { month: "short", day: "numeric", timeZone: "UTC" });
}

async function resolveProductId(executor: SqlExecutor, productId: number | null | undefined, sku: string | null | undefined) {
  if (productId != null && Number.isFinite(productId)) {
    return productId;
  }

  const normalizedSku = trimText(sku);
  if (!normalizedSku) {
    return null;
  }

  const result = await executor.query<{ id: number }>(
    `
      select id
      from public.products
      where lower(sku) = lower($1)
      limit 1
    `,
    [normalizedSku]
  );

  return result.rows[0]?.id ?? null;
}

function deriveSourceLabel(row: Pick<
  AnalyticsEventRow,
  "utm_source" | "utm_medium" | "referrer_host" | "referrer" | "source_host"
>) {
  const utmSource = trimText(row.utm_source)?.toLowerCase();
  if (utmSource) {
    return utmSource;
  }

  if (isInternalHost(row.referrer_host, row.source_host)) {
    return "direct";
  }

  const referrerHost = trimText(row.referrer_host)?.toLowerCase()?.replace(/^www\./, "");
  if (!referrerHost) {
    return "direct";
  }

  if (referrerHost === "l.facebook.com" || referrerHost.includes("facebook.com") || referrerHost.includes("messenger.com")) {
    return "facebook";
  }

  if (referrerHost.includes("instagram.com")) {
    return "instagram";
  }

  if (referrerHost.includes("google.")) {
    return "google";
  }

  if (referrerHost.includes("wa.me") || referrerHost.includes("whatsapp.com")) {
    return "whatsapp";
  }

  if (referrerHost.includes("telegram.") || referrerHost.includes("t.me")) {
    return "telegram";
  }

  if (referrerHost.includes("youtube.")) {
    return "youtube";
  }

  if (referrerHost.includes("x.com") || referrerHost.includes("twitter.com") || referrerHost === "t.co") {
    return "x";
  }

  return referrerHost;
}

function eventDateKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatPct(value: number, total: number) {
  if (total <= 0) return null;
  return Number(((value / total) * 100).toFixed(1));
}

function visitorLabel(value: string) {
  if (!value) {
    return "Unknown visitor";
  }

  if (value.length <= 16) {
    return `Visitor ${value}`;
  }

  return `Visitor ${value.slice(0, 8)}`;
}

function customerLabel(row: Pick<AnalyticsEventRow, "customer_first_name" | "customer_last_name" | "customer_phone" | "customer_email">) {
  const fullName = [trimText(row.customer_first_name), trimText(row.customer_last_name)].filter(Boolean).join(" ");
  if (fullName) return fullName;
  if (trimText(row.customer_phone)) return trimText(row.customer_phone);
  if (trimText(row.customer_email)) return trimText(row.customer_email);
  return null;
}

export async function recordStorefrontEvent(input: RecordStorefrontEventInput, executor: SqlExecutor = pool) {
  const pageUrl = normalizeUrl(input.pageUrl);
  const referrer = normalizeUrl(input.referrer);
  const parsedUtms = parseUtms(pageUrl);
  const productId = await resolveProductId(executor, input.productId, input.sku);
  const pagePath = normalizePath(input.pagePath) || normalizePath(pageUrl);
  const sourceHost = trimText(input.sourceHost) || hostFromUrl(pageUrl);
  const eventTime =
    input.eventTime instanceof Date
      ? input.eventTime.toISOString()
      : trimText(typeof input.eventTime === "string" ? input.eventTime : null) || new Date().toISOString();

  const values = [
    input.eventName,
    trimText(input.eventKey),
    input.receivedFrom ?? "browser",
    trimText(input.visitorId),
    trimText(input.sessionId),
    sourceHost,
    pageUrl,
    pagePath,
    referrer,
    hostFromUrl(referrer),
    trimText(input.utmSource) || parsedUtms.utmSource,
    trimText(input.utmMedium) || parsedUtms.utmMedium,
    trimText(input.utmCampaign) || parsedUtms.utmCampaign,
    trimText(input.utmTerm) || parsedUtms.utmTerm,
    trimText(input.utmContent) || parsedUtms.utmContent,
    productId,
    input.orderId ?? null,
    input.customerId ?? null,
    input.checkoutIntentId ?? null,
    trimText(input.currencyCode),
    input.valueAmount ?? null,
    input.payload ?? {},
    eventTime,
  ];

  const result = await executor.query<{ id: number }>(
    `
      insert into public.storefront_events (
        event_name,
        event_key,
        received_from,
        visitor_id,
        session_id,
        source_host,
        page_url,
        page_path,
        referrer,
        referrer_host,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        product_id,
        order_id,
        customer_id,
        checkout_intent_id,
        currency_code,
        value_amount,
        payload,
        event_time
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
      )
      on conflict (event_key) do update
      set
        received_from = excluded.received_from,
        visitor_id = coalesce(storefront_events.visitor_id, excluded.visitor_id),
        session_id = coalesce(storefront_events.session_id, excluded.session_id),
        source_host = coalesce(excluded.source_host, storefront_events.source_host),
        page_url = coalesce(excluded.page_url, storefront_events.page_url),
        page_path = coalesce(excluded.page_path, storefront_events.page_path),
        referrer = coalesce(excluded.referrer, storefront_events.referrer),
        referrer_host = coalesce(excluded.referrer_host, storefront_events.referrer_host),
        utm_source = coalesce(excluded.utm_source, storefront_events.utm_source),
        utm_medium = coalesce(excluded.utm_medium, storefront_events.utm_medium),
        utm_campaign = coalesce(excluded.utm_campaign, storefront_events.utm_campaign),
        utm_term = coalesce(excluded.utm_term, storefront_events.utm_term),
        utm_content = coalesce(excluded.utm_content, storefront_events.utm_content),
        product_id = coalesce(excluded.product_id, storefront_events.product_id),
        order_id = coalesce(excluded.order_id, storefront_events.order_id),
        customer_id = coalesce(excluded.customer_id, storefront_events.customer_id),
        checkout_intent_id = coalesce(excluded.checkout_intent_id, storefront_events.checkout_intent_id),
        currency_code = coalesce(excluded.currency_code, storefront_events.currency_code),
        value_amount = coalesce(excluded.value_amount, storefront_events.value_amount),
        payload = storefront_events.payload || excluded.payload,
        event_time = greatest(storefront_events.event_time, excluded.event_time)
      returning id
    `,
    values
  );

  return result.rows[0]?.id ?? null;
}

export async function recordStorefrontPurchaseEvent(orderId: number): Promise<StorefrontPurchaseEventResult> {
  const rows = await query<PurchaseContextRow>(
    `
      select
        o.id as order_id,
        o.order_number,
        o.status as order_status,
        o.currency_code as order_currency_code,
        o.total_amount,
        o.customer_id,
        c.phone as customer_phone,
        c.email as customer_email,
        product_ref.product_id,
        p.sku,
        checkout_ref.checkout_intent_id,
        checkout_ref.source_host,
        checkout_ref.checkout_metadata
      from public.orders o
      left join public.customers c on c.id = o.customer_id
      left join lateral (
        select oi.product_id
        from public.order_items oi
        where oi.order_id = o.id
          and oi.product_id is not null
        order by oi.id asc
        limit 1
      ) product_ref on true
      left join public.products p on p.id = product_ref.product_id
      left join lateral (
        select
          sci.id as checkout_intent_id,
          sci.source_host,
          sci.metadata as checkout_metadata
        from public.storefront_checkout_intents sci
        where sci.order_id = o.id
        order by sci.id desc
        limit 1
      ) checkout_ref on true
      where o.id = $1
      limit 1
    `,
    [orderId]
  );

  const row = rows[0];

  if (!row) {
    return {
      ok: false,
      skipped: true,
      reason: "order_not_found",
    };
  }

  if (!["paid", "fulfilled"].includes(row.order_status)) {
    return {
      ok: false,
      skipped: true,
      reason: "order_not_finalized",
    };
  }

  const metadata = asRecord(row.checkout_metadata) ?? {};
  const analytics = asRecord(metadata.analytics) ?? {};

  await recordStorefrontEvent({
    eventName: "purchase",
    eventKey: `order-${row.order_id}-purchase`,
    receivedFrom: "server",
    visitorId: trimText(typeof analytics.visitor_id === "string" ? analytics.visitor_id : null),
    sessionId: trimText(typeof analytics.session_id === "string" ? analytics.session_id : null),
    sourceHost: row.source_host,
    pageUrl: trimText(typeof analytics.page_url === "string" ? analytics.page_url : null),
    pagePath:
      trimText(typeof analytics.page_path === "string" ? analytics.page_path : null) ||
      trimText(typeof metadata.source_path === "string" ? metadata.source_path : null),
    referrer: trimText(typeof analytics.referrer === "string" ? analytics.referrer : null),
    utmSource: trimText(typeof analytics.utm_source === "string" ? analytics.utm_source : null),
    utmMedium: trimText(typeof analytics.utm_medium === "string" ? analytics.utm_medium : null),
    utmCampaign: trimText(typeof analytics.utm_campaign === "string" ? analytics.utm_campaign : null),
    utmTerm: trimText(typeof analytics.utm_term === "string" ? analytics.utm_term : null),
    utmContent: trimText(typeof analytics.utm_content === "string" ? analytics.utm_content : null),
    productId: row.product_id,
    sku: row.sku,
    orderId: row.order_id,
    customerId: row.customer_id,
    checkoutIntentId: row.checkout_intent_id,
    valueAmount: toNumber(row.total_amount),
    currencyCode: row.order_currency_code,
    payload: {
      order_number: row.order_number,
      order_status: row.order_status,
      customer_phone_present: Boolean(row.customer_phone),
      customer_email_present: Boolean(row.customer_email),
      device_type: trimText(typeof analytics.device_type === "string" ? analytics.device_type : null),
      device_family: trimText(typeof analytics.device_family === "string" ? analytics.device_family : null),
      os_name: trimText(typeof analytics.os_name === "string" ? analytics.os_name : null),
      browser_name: trimText(typeof analytics.browser_name === "string" ? analytics.browser_name : null),
      user_agent: trimText(typeof analytics.user_agent === "string" ? analytics.user_agent : null),
      screen_width: toNumber(typeof analytics.screen_width === "number" || typeof analytics.screen_width === "string" ? analytics.screen_width : null),
      screen_height: toNumber(typeof analytics.screen_height === "number" || typeof analytics.screen_height === "string" ? analytics.screen_height : null),
      viewport_width: toNumber(typeof analytics.viewport_width === "number" || typeof analytics.viewport_width === "string" ? analytics.viewport_width : null),
      viewport_height: toNumber(typeof analytics.viewport_height === "number" || typeof analytics.viewport_height === "string" ? analytics.viewport_height : null),
      language: trimText(typeof analytics.language === "string" ? analytics.language : null),
    },
  });

  return { ok: true };
}

export async function getStorefrontAnalyticsOverview(options?: StorefrontAnalyticsOverviewOptions): Promise<StorefrontAnalyticsOverview> {
  const days = Math.max(1, Math.min(180, Number(options?.days ?? 30) || 30));
  const sourceFilter = normalizeFilterKey(options?.source);
  const deviceFilter = normalizeFilterKey(options?.device);
  const interval = normalizeTimeBucketInterval(options?.interval);
  const rows = await query<AnalyticsEventRow>(
    `
      select
        e.id,
        e.event_name,
        e.received_from,
        e.visitor_id,
        e.session_id,
        e.source_host,
        e.page_url,
        e.page_path,
        e.referrer,
        e.referrer_host,
        e.utm_source,
        e.utm_medium,
        e.utm_campaign,
        e.utm_term,
        e.utm_content,
        e.product_id,
        e.order_id,
        e.customer_id,
        e.checkout_intent_id,
        e.currency_code,
        e.value_amount,
        e.payload,
        e.event_time::text as event_time,
        p.sku as product_sku,
        p.title as product_title,
        p.brand as product_brand,
        o.order_number,
        o.status as order_status,
        o.total_amount as order_total_amount,
        o.currency_code as order_currency_code,
        c.first_name as customer_first_name,
        c.last_name as customer_last_name,
        c.phone as customer_phone,
        c.email as customer_email
      from public.storefront_events e
      left join public.products p on p.id = e.product_id
      left join public.orders o on o.id = e.order_id
      left join public.customers c on c.id = coalesce(e.customer_id, o.customer_id)
      where e.event_time >= now() - make_interval(days => $1::int)
      order by e.event_time asc, e.id asc
    `,
    [days]
  );

  const warnings: string[] = [];
  const availableSources = new Set<string>();
  const availableDevices = new Set<string>();

  if (rows.length === 0) {
    warnings.push("No storefront events have been recorded yet for the selected window.");
  }

  const totals = {
    events: rows.length,
    visitors: 0,
    sessions: 0,
    page_views: 0,
    searches: 0,
    view_contents: 0,
    contacts: 0,
    checkout_starts: 0,
    purchases: 0,
    revenue_ars: 0,
    contact_rate_pct: null as number | null,
    checkout_rate_pct: null as number | null,
    purchase_rate_pct: null as number | null,
    avg_session_duration_seconds: null as number | null,
  };

  const dailyMap = new Map<string, StorefrontAnalyticsOverview["daily"][number]>();
  const sourceMap = new Map<
    string,
    StorefrontAnalyticsOverview["sources"][number] & {
      _visitors: Set<string>;
      _campaigns: Map<string, number>;
    }
  >();
  const landingMap = new Map<string, StorefrontAnalyticsOverview["landing_pages"][number] & { _visitors: Set<string> }>();
  const productMap = new Map<string, StorefrontAnalyticsOverview["products"][number]>();
  const sessionMap = new Map<
    string,
    {
      id: string;
      visitorId: string;
      firstSeen: string;
      lastSeen: string;
      source: string;
      campaign: string | null;
      landingPage: string | null;
      counts: Record<StorefrontEventName, number>;
      revenue: number;
      lastProduct: string | null;
      identifiedCustomer: string | null;
      phone: string | null;
      email: string | null;
      deviceFamily: string | null;
      deviceType: string | null;
      osName: string | null;
      browserName: string | null;
    }
  >();
  const deviceMap = new Map<
    string,
    StorefrontAnalyticsOverview["devices"][number] & {
      _visitors: Set<string>;
    }
  >();
  const searchMap = new Map<
    string,
    StorefrontAnalyticsOverview["searches"][number] & {
      _visitors: Set<string>;
      _sessions: Set<string>;
      _sources: Map<string, number>;
      _devices: Map<string, number>;
      _resultsTotal: number;
      _resultsSeen: number;
    }
  >();
  const sessionSearchTrail = new Map<
    string,
    Array<{
      query: string;
      normalizedQuery: string;
      visitorKey: string;
      source: string;
      deviceFamily: string;
      resultsCount: number | null;
    }>
  >();
  const peopleMap = new Map<
    string,
    StorefrontAnalyticsOverview["people"][number] & { _sessionIds: Set<string>; _durationTotal: number; _durationCount: number }
  >();

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const firstBucket = bucketStartForDate(start, interval);
  const lastBucket = bucketStartForDate(end, interval);

  for (let cursor = new Date(firstBucket); cursor <= lastBucket; cursor = addBucket(cursor, interval)) {
    const key = cursor.toISOString().slice(0, 10);
    dailyMap.set(key, {
      date: key,
      label: formatBucketLabel(cursor, interval),
      page_views: 0,
      searches: 0,
      view_contents: 0,
      contacts: 0,
      checkout_starts: 0,
      purchases: 0,
      revenue_ars: 0,
    });
  }

  for (const row of rows) {
    const source = deriveSourceLabel(row);
    const campaign = trimText(row.utm_campaign);
    const visitorId = trimText(row.visitor_id);
    const sessionId = trimText(row.session_id);
    const visitorKey = visitorId || (sessionId ? `session:${sessionId}` : `event:${row.id}`);
    const sessionKey = sessionId || (visitorId ? `visitor:${visitorId}` : `event:${row.id}`);
    const dateKey = bucketStartForDate(new Date(row.event_time), interval).toISOString().slice(0, 10);
    const valueAmount = toNumber(row.value_amount) ?? 0;
    const person = customerLabel(row);
    const deviceContext = deriveDeviceContext(row.payload);
    const deviceFamily = deviceContext.deviceFamily;
    const deviceType = deviceContext.deviceType;
    const osName = deviceContext.osName;
    const browserName = deviceContext.browserName;
    const searchQuery = payloadString(row.payload, "search_query");
    const resultsCount = payloadNumber(row.payload, "results_count");
    const productLabel =
      trimText(row.product_title) || trimText(row.product_sku) || trimText(typeof row.payload?.["product_title"] === "string" ? row.payload.product_title : null);

    availableSources.add(source);
    availableDevices.add(deviceFamily);

    if (sourceFilter && source !== sourceFilter) {
      continue;
    }

    if (deviceFilter && normalizeFilterKey(deviceFamily) !== deviceFilter) {
      continue;
    }

    if (row.event_name === "page_view") totals.page_views += 1;
    if (row.event_name === "search") totals.searches += 1;
    if (row.event_name === "view_content") totals.view_contents += 1;
    if (row.event_name === "contact") totals.contacts += 1;
    if (row.event_name === "initiate_checkout") totals.checkout_starts += 1;
    if (row.event_name === "purchase") {
      totals.purchases += 1;
      totals.revenue_ars += valueAmount;
    }

    const daily = dailyMap.get(dateKey);
    if (daily) {
      if (row.event_name === "page_view") daily.page_views += 1;
      if (row.event_name === "search") daily.searches += 1;
      if (row.event_name === "view_content") daily.view_contents += 1;
      if (row.event_name === "contact") daily.contacts += 1;
      if (row.event_name === "initiate_checkout") daily.checkout_starts += 1;
      if (row.event_name === "purchase") {
        daily.purchases += 1;
        daily.revenue_ars += valueAmount;
      }
    }

    if (!sessionMap.has(sessionKey)) {
      sessionMap.set(sessionKey, {
        id: sessionKey,
        visitorId: visitorKey,
        firstSeen: row.event_time,
        lastSeen: row.event_time,
        source,
        campaign,
        landingPage: trimText(row.page_path),
        counts: {
          page_view: 0,
          search: 0,
          view_content: 0,
          contact: 0,
          initiate_checkout: 0,
          purchase: 0,
        },
        revenue: 0,
        lastProduct: null,
        identifiedCustomer: person,
        phone: trimText(row.customer_phone),
        email: trimText(row.customer_email),
        deviceFamily,
        deviceType,
        osName,
        browserName,
      });
    }

    const session = sessionMap.get(sessionKey)!;
    session.lastSeen = row.event_time;
    session.counts[row.event_name] += 1;
    if (!session.source && source) {
      session.source = source;
    }
    if (!session.campaign && campaign) {
      session.campaign = campaign;
    }
    if (!session.landingPage && trimText(row.page_path)) {
      session.landingPage = trimText(row.page_path);
    }
    session.deviceFamily = preferValue(session.deviceFamily, deviceFamily);
    session.deviceType = preferValue(session.deviceType, deviceType);
    session.osName = preferValue(session.osName, osName);
    session.browserName = preferValue(session.browserName, browserName);
    if (productLabel) {
      session.lastProduct = productLabel;
    }
    if (row.event_name === "purchase") {
      session.revenue += valueAmount;
    }
    if (person) {
      session.identifiedCustomer = person;
    }
    if (!session.phone && trimText(row.customer_phone)) {
      session.phone = trimText(row.customer_phone);
    }
    if (!session.email && trimText(row.customer_email)) {
      session.email = trimText(row.customer_email);
    }

    if (!peopleMap.has(visitorKey)) {
      peopleMap.set(visitorKey, {
        visitor_id: visitorKey,
        label: person || visitorLabel(visitorKey),
        first_seen: row.event_time,
        last_seen: row.event_time,
        source,
        landing_page: trimText(row.page_path),
        sessions: 0,
        page_views: 0,
        view_contents: 0,
        contacts: 0,
        checkout_starts: 0,
        purchases: 0,
        revenue_ars: 0,
        last_product: null,
        identified_customer: person,
        phone: trimText(row.customer_phone),
        email: trimText(row.customer_email),
        device_family: deviceFamily,
        device_type: deviceType,
        os_name: osName,
        browser_name: browserName,
        avg_session_duration_seconds: null,
        _sessionIds: new Set<string>(),
        _durationTotal: 0,
        _durationCount: 0,
      });
    }

    const personEntry = peopleMap.get(visitorKey)!;
    personEntry.last_seen = row.event_time;
    personEntry._sessionIds.add(sessionKey);
    if (!personEntry.landing_page && trimText(row.page_path)) {
      personEntry.landing_page = trimText(row.page_path);
    }
    if (productLabel) {
      personEntry.last_product = productLabel;
    }
    if (person) {
      personEntry.label = person;
      personEntry.identified_customer = person;
    }
    if (!personEntry.phone && trimText(row.customer_phone)) {
      personEntry.phone = trimText(row.customer_phone);
    }
    if (!personEntry.email && trimText(row.customer_email)) {
      personEntry.email = trimText(row.customer_email);
    }
    personEntry.device_family = preferValue(personEntry.device_family, deviceFamily);
    personEntry.device_type = preferValue(personEntry.device_type, deviceType);
    personEntry.os_name = preferValue(personEntry.os_name, osName);
    personEntry.browser_name = preferValue(personEntry.browser_name, browserName);
    if (row.event_name === "page_view") personEntry.page_views += 1;
    if (row.event_name === "search" && searchQuery) {
      const normalizedQuery = isMeaningfulSearchQuery(searchQuery) ? normalizeSearchText(searchQuery) : null;
      if (normalizedQuery) {
        const trail = sessionSearchTrail.get(sessionKey) ?? [];
        trail.push({
          query: searchQuery,
          normalizedQuery,
          visitorKey,
          source,
          deviceFamily,
          resultsCount,
        });
        sessionSearchTrail.set(sessionKey, trail);
      }
    }
    if (row.event_name === "view_content") personEntry.view_contents += 1;
    if (row.event_name === "contact") personEntry.contacts += 1;
    if (row.event_name === "initiate_checkout") personEntry.checkout_starts += 1;
    if (row.event_name === "purchase") {
      personEntry.purchases += 1;
      personEntry.revenue_ars += valueAmount;
    }

    if (row.product_id != null || trimText(row.product_sku) || productLabel) {
      const productKey = row.product_id != null ? String(row.product_id) : trimText(row.product_sku) || productLabel || `event:${row.id}`;
      if (!productMap.has(productKey)) {
        productMap.set(productKey, {
          product_id: row.product_id,
          sku: trimText(row.product_sku),
          url_path: trimText(row.product_sku) ? `/${trimText(row.product_sku)}` : null,
          title: productLabel || "Unknown product",
          brand: trimText(row.product_brand),
          view_contents: 0,
          contacts: 0,
          checkout_starts: 0,
          purchases: 0,
          revenue_ars: 0,
          last_seen: row.event_time,
        });
      }

      const product = productMap.get(productKey)!;
      product.last_seen = row.event_time;
      if (row.event_name === "view_content") product.view_contents += 1;
      if (row.event_name === "contact") product.contacts += 1;
      if (row.event_name === "initiate_checkout") product.checkout_starts += 1;
      if (row.event_name === "purchase") {
        product.purchases += 1;
        product.revenue_ars += valueAmount;
      }
    }
  }

  for (const session of sessionMap.values()) {
    const durationSeconds = sessionDurationSeconds(session.firstSeen, session.lastSeen) ?? 0;
    const sourceKey = session.source || "direct";
    if (!sourceMap.has(sourceKey)) {
      sourceMap.set(sourceKey, {
        source: sourceKey,
        sessions: 0,
        visitors: 0,
        page_views: 0,
        searches: 0,
        view_contents: 0,
        contacts: 0,
        checkout_starts: 0,
        purchases: 0,
        revenue_ars: 0,
        top_campaign: null,
        landing_page: null,
        _visitors: new Set<string>(),
        _campaigns: new Map<string, number>(),
      });
    }

    const sourceEntry = sourceMap.get(sourceKey)!;
    sourceEntry.sessions += 1;
    sourceEntry._visitors.add(session.visitorId);
    sourceEntry.page_views += session.counts.page_view;
    sourceEntry.searches += session.counts.search;
    sourceEntry.view_contents += session.counts.view_content;
    sourceEntry.contacts += session.counts.contact;
    sourceEntry.checkout_starts += session.counts.initiate_checkout;
    sourceEntry.purchases += session.counts.purchase;
    sourceEntry.revenue_ars += session.revenue;
    if (!sourceEntry.landing_page && session.landingPage) {
      sourceEntry.landing_page = session.landingPage;
    }
    if (session.campaign) {
      sourceEntry._campaigns.set(session.campaign, (sourceEntry._campaigns.get(session.campaign) ?? 0) + 1);
    }

    const landingKey = session.landingPage || "(unknown)";
    if (!landingMap.has(landingKey)) {
      landingMap.set(landingKey, {
        path: landingKey,
        sessions: 0,
        visitors: 0,
        page_views: 0,
        view_contents: 0,
        contacts: 0,
        checkout_starts: 0,
        purchases: 0,
        revenue_ars: 0,
        _visitors: new Set<string>(),
      });
    }

    const landing = landingMap.get(landingKey)!;
    landing.sessions += 1;
    landing._visitors.add(session.visitorId);
    landing.page_views += session.counts.page_view;
    landing.view_contents += session.counts.view_content;
    landing.contacts += session.counts.contact;
    landing.checkout_starts += session.counts.initiate_checkout;
    landing.purchases += session.counts.purchase;
    landing.revenue_ars += session.revenue;

    const deviceKey = session.deviceFamily || session.osName || "unknown";
    if (!deviceMap.has(deviceKey)) {
      deviceMap.set(deviceKey, {
        device_family: deviceKey,
        device_type: session.deviceType || "unknown",
        os_name: session.osName,
        browser_name: session.browserName,
        sessions: 0,
        visitors: 0,
        searches: 0,
        view_contents: 0,
        contacts: 0,
        checkout_starts: 0,
        purchases: 0,
        revenue_ars: 0,
        _visitors: new Set<string>(),
      });
    }

    const deviceEntry = deviceMap.get(deviceKey)!;
    deviceEntry.sessions += 1;
    deviceEntry._visitors.add(session.visitorId);
    deviceEntry.searches += session.counts.search;
    deviceEntry.view_contents += session.counts.view_content;
    deviceEntry.contacts += session.counts.contact;
    deviceEntry.checkout_starts += session.counts.initiate_checkout;
    deviceEntry.purchases += session.counts.purchase;
    deviceEntry.revenue_ars += session.revenue;

    const personEntry = peopleMap.get(session.visitorId);
    if (personEntry && durationSeconds >= 0) {
      personEntry._durationTotal += durationSeconds;
      personEntry._durationCount += 1;
    }
  }

  for (const [searchSessionKey, trail] of sessionSearchTrail.entries()) {
    const collapsed: typeof trail = [];

    for (const entry of trail) {
      if (!isMeaningfulSearchQuery(entry.normalizedQuery)) {
        continue;
      }

      const previous = collapsed[collapsed.length - 1];
      if (previous && entry.normalizedQuery.startsWith(previous.normalizedQuery)) {
        collapsed[collapsed.length - 1] = entry;
      } else if (!previous || previous.normalizedQuery !== entry.normalizedQuery) {
        collapsed.push(entry);
      }
    }

    for (const entry of collapsed) {
      if (!searchMap.has(entry.normalizedQuery)) {
        searchMap.set(entry.normalizedQuery, {
          query: entry.query,
          searches: 0,
          visitors: 0,
          sessions: 0,
          avg_results_count: null,
          top_source: null,
          top_device: null,
          _visitors: new Set<string>(),
          _sessions: new Set<string>(),
          _sources: new Map<string, number>(),
          _devices: new Map<string, number>(),
          _resultsTotal: 0,
          _resultsSeen: 0,
        });
      }

      const searchEntry = searchMap.get(entry.normalizedQuery)!;
      searchEntry.query = entry.query;
      searchEntry.searches += 1;
      searchEntry._visitors.add(entry.visitorKey);
      searchEntry._sessions.add(searchSessionKey);
      searchEntry._sources.set(entry.source, (searchEntry._sources.get(entry.source) ?? 0) + 1);
      searchEntry._devices.set(entry.deviceFamily, (searchEntry._devices.get(entry.deviceFamily) ?? 0) + 1);
      if (entry.resultsCount != null) {
        searchEntry._resultsTotal += entry.resultsCount;
        searchEntry._resultsSeen += 1;
      }
    }
  }

  const visitors = Array.from(peopleMap.values()).map((entry) => ({
    ...entry,
    sessions: entry._sessionIds.size,
    avg_session_duration_seconds:
      entry._durationCount > 0 ? Math.round(entry._durationTotal / entry._durationCount) : null,
  }));

  totals.visitors = visitors.length;
  totals.sessions = sessionMap.size;
  const allDurations = Array.from(sessionMap.values())
    .map((session) => sessionDurationSeconds(session.firstSeen, session.lastSeen))
    .filter((value): value is number => value != null);
  totals.avg_session_duration_seconds =
    allDurations.length > 0 ? Math.round(allDurations.reduce((sum, value) => sum + value, 0) / allDurations.length) : null;

  const sessionStepCounts = {
    page_view: 0,
    search: 0,
    view_content: 0,
    contact: 0,
    initiate_checkout: 0,
    purchase: 0,
  } as Record<StorefrontEventName, number>;

  for (const session of sessionMap.values()) {
    if (session.counts.page_view > 0) sessionStepCounts.page_view += 1;
    if (session.counts.search > 0) sessionStepCounts.search += 1;
    if (session.counts.view_content > 0) sessionStepCounts.view_content += 1;
    if (session.counts.contact > 0) sessionStepCounts.contact += 1;
    if (session.counts.initiate_checkout > 0) sessionStepCounts.initiate_checkout += 1;
    if (session.counts.purchase > 0) sessionStepCounts.purchase += 1;
  }

  totals.contact_rate_pct = formatPct(sessionStepCounts.contact, totals.sessions);
  totals.checkout_rate_pct = formatPct(sessionStepCounts.initiate_checkout, totals.sessions);
  totals.purchase_rate_pct = formatPct(sessionStepCounts.purchase, totals.sessions);

  const journeyCounts = {
    sessions: totals.sessions,
    view_content: 0,
    engaged: 0,
    purchase: 0,
  };

  for (const session of sessionMap.values()) {
    const viewed = session.counts.view_content > 0;
    const engaged = viewed && (session.counts.contact > 0 || session.counts.initiate_checkout > 0);
    const purchased = engaged && session.counts.purchase > 0;

    if (viewed) journeyCounts.view_content += 1;
    if (engaged) journeyCounts.engaged += 1;
    if (purchased) journeyCounts.purchase += 1;
  }

  if (totals.page_views > 0 && totals.view_contents === 0) {
    warnings.push("Page views are being recorded, but no product detail views have been captured yet.");
  }

  if (totals.searches === 0) {
    warnings.push("Search terms are not appearing yet. Once visitors use the storefront search box, top queries will show up here.");
  }

  if (totals.checkout_starts > 0 && totals.purchases === 0) {
    warnings.push("Checkout starts are arriving, but no paid purchase event has been recorded yet.");
  }

  if (sourceMap.size > 0 && Array.from(sourceMap.values()).every((entry) => entry.source === "direct")) {
    warnings.push("Traffic is mostly direct right now. Add UTM tags to campaigns to improve source attribution.");
  }

  const journeySteps: Array<{
    key: "sessions" | "view_content" | "engaged" | "purchase";
    label: string;
    detail: string;
    count: number;
  }> = [
    { key: "sessions", label: "Sesiones", detail: "Base total del período", count: journeyCounts.sessions },
    { key: "view_content", label: "Vista de producto", detail: "Entraron a una PDP real", count: journeyCounts.view_content },
    { key: "engaged", label: "Señal de intención", detail: "WhatsApp o checkout", count: journeyCounts.engaged },
    { key: "purchase", label: "Compra", detail: "Orden finalizada con señal previa", count: journeyCounts.purchase },
  ];

  return {
    generated_at: new Date().toISOString(),
    window_days: days,
    filters: {
      applied: {
        source: sourceFilter,
        device: deviceFilter,
        interval,
      },
      available: {
        sources: Array.from(availableSources).sort((a, b) => a.localeCompare(b)),
        devices: Array.from(availableDevices).sort((a, b) => {
          if (isUnknownish(a) && !isUnknownish(b)) return 1;
          if (!isUnknownish(a) && isUnknownish(b)) return -1;
          return a.localeCompare(b);
        }),
        intervals: ["day", "week", "month"],
      },
    },
    warnings,
    totals,
    journey: journeySteps.map((step, index) => ({
      key: step.key,
      label: step.label,
      detail: step.detail,
      count: step.count,
      conversion_from_previous_pct: index === 0 ? null : formatPct(step.count, journeySteps[index - 1]?.count ?? 0),
      conversion_from_sessions_pct: formatPct(step.count, totals.sessions),
    })),
    daily: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    sources: Array.from(sourceMap.values())
      .map((entry) => ({
        source: entry.source,
        sessions: entry.sessions,
        visitors: entry._visitors.size,
        page_views: entry.page_views,
        searches: entry.searches,
        view_contents: entry.view_contents,
        contacts: entry.contacts,
        checkout_starts: entry.checkout_starts,
        purchases: entry.purchases,
        revenue_ars: Number(entry.revenue_ars.toFixed(2)),
        top_campaign:
          Array.from(entry._campaigns.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        landing_page: entry.landing_page,
      }))
      .sort((a, b) => b.sessions - a.sessions || b.view_contents - a.view_contents || b.contacts - a.contacts)
      .slice(0, 12),
    devices: Array.from(deviceMap.values())
      .map((entry) => ({
        device_family: entry.device_family,
        device_type: entry.device_type,
        os_name: entry.os_name,
        browser_name: entry.browser_name,
        sessions: entry.sessions,
        visitors: entry._visitors.size,
        searches: entry.searches,
        view_contents: entry.view_contents,
        contacts: entry.contacts,
        checkout_starts: entry.checkout_starts,
        purchases: entry.purchases,
        revenue_ars: Number(entry.revenue_ars.toFixed(2)),
      }))
      .sort((a, b) => {
        if (isUnknownish(a.device_family) && !isUnknownish(b.device_family)) return 1;
        if (!isUnknownish(a.device_family) && isUnknownish(b.device_family)) return -1;
        return b.sessions - a.sessions || b.view_contents - a.view_contents || b.searches - a.searches;
      })
      .slice(0, 12),
    searches: (() => {
      const entries = Array.from(searchMap.values())
        .map((entry) => ({
          query: entry.query,
          searches: entry.searches,
          visitors: entry._visitors.size,
          sessions: entry._sessions.size,
          avg_results_count: entry._resultsSeen > 0 ? Number((entry._resultsTotal / entry._resultsSeen).toFixed(1)) : null,
          top_source: Array.from(entry._sources.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
          top_device: Array.from(entry._devices.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        }))
        .sort((a, b) => b.searches - a.searches || b.sessions - a.sessions || (b.avg_results_count ?? -1) - (a.avg_results_count ?? -1));

      const filtered = entries.filter((entry) => entry.searches >= 2 || entry.sessions >= 2 || (entry.avg_results_count ?? 0) > 0);
      return (filtered.length > 0 ? filtered : entries).slice(0, 16);
    })(),
    landing_pages: Array.from(landingMap.values())
      .map((entry) => ({
        path: entry.path,
        sessions: entry.sessions,
        visitors: entry._visitors.size,
        page_views: entry.page_views,
        view_contents: entry.view_contents,
        contacts: entry.contacts,
        checkout_starts: entry.checkout_starts,
        purchases: entry.purchases,
        revenue_ars: Number(entry.revenue_ars.toFixed(2)),
      }))
      .sort((a, b) => {
        if (isLowSignalLandingPath(a.path) && !isLowSignalLandingPath(b.path)) return 1;
        if (!isLowSignalLandingPath(a.path) && isLowSignalLandingPath(b.path)) return -1;
        return b.view_contents - a.view_contents || b.page_views - a.page_views || b.sessions - a.sessions;
      })
      .slice(0, 12),
    products: Array.from(productMap.values())
      .sort((a, b) => b.view_contents - a.view_contents || b.contacts - a.contacts || b.checkout_starts - a.checkout_starts || b.purchases - a.purchases)
      .slice(0, 16),
    people: visitors
      .sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime())
      .slice(0, 20)
      .map(({ _sessionIds, _durationTotal, _durationCount, ...entry }) => entry),
    recent_events: rows
      .slice(-60)
      .reverse()
      .map((row) => ({
        id: row.id,
        event_name: row.event_name,
        received_from: row.received_from,
        at: row.event_time,
        source: deriveSourceLabel(row),
        campaign: trimText(row.utm_campaign),
        page_path: trimText(row.page_path),
        product: trimText(row.product_title) || trimText(row.product_sku),
        search_query: payloadString(row.payload, "search_query"),
        device_family: deriveDeviceContext(row.payload).deviceFamily,
        visitor: trimText(row.visitor_id) || trimText(row.session_id),
        person: customerLabel(row),
        order_number: trimText(row.order_number),
        value_amount: toNumber(row.value_amount),
        currency_code: trimText(row.currency_code) || trimText(row.order_currency_code),
      })),
  };
}
