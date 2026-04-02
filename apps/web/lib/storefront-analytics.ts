"use client";

type StorefrontEventName = "page_view" | "search" | "view_content" | "contact" | "initiate_checkout";

type StorefrontEventPayload = {
  event_key?: string | null;
  source_host?: string | null;
  page_url?: string | null;
  page_path?: string | null;
  referrer?: string | null;
  product_id?: number | null;
  sku?: string | null;
  value_amount?: number | null;
  currency_code?: string | null;
  payload?: Record<string, unknown>;
};

type StorefrontAnalyticsContext = {
  visitor_id: string;
  session_id: string;
  source_host: string;
  page_url: string;
  page_path: string;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  device_type: "desktop" | "mobile" | "tablet";
  device_family: string;
  os_name: string;
  browser_name: string;
  user_agent: string | null;
  screen_width: number | null;
  screen_height: number | null;
  viewport_width: number | null;
  viewport_height: number | null;
  language: string | null;
};

const VISITOR_STORAGE_KEY = "toc_storefront_visitor_id";
const SESSION_STORAGE_KEY = "toc_storefront_session_id";

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function readOrCreateStorageValue(storage: Storage, key: string, prefix: string) {
  const existing = storage.getItem(key)?.trim();
  if (existing) {
    return existing;
  }

  const nextValue = makeId(prefix);
  storage.setItem(key, nextValue);
  return nextValue;
}

function inferClientDeviceContext(): Omit<
  StorefrontAnalyticsContext,
  "visitor_id" | "session_id" | "source_host" | "page_url" | "page_path" | "referrer" | "utm_source" | "utm_medium" | "utm_campaign" | "utm_term" | "utm_content"
> {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent || "";
  const lower = ua.toLowerCase();

  const device_type = /ipad|tablet/.test(lower)
    ? "tablet"
    : /iphone|ipod|android.+mobile|mobile|windows phone/.test(lower)
      ? "mobile"
      : "desktop";

  const device_family = /iphone/.test(lower)
    ? "iphone"
    : /ipad/.test(lower)
      ? "ipad"
      : /macintosh|mac os x/.test(lower)
        ? "mac"
        : /android/.test(lower)
          ? "android"
          : /windows/.test(lower)
            ? "windows"
            : /linux/.test(lower)
              ? "linux"
              : "unknown";

  const os_name = /iphone|ipad|cpu iphone os|cpu os/.test(lower)
    ? "iOS"
    : /android/.test(lower)
      ? "Android"
      : /windows/.test(lower)
        ? "Windows"
        : /mac os x|macintosh/.test(lower)
          ? "macOS"
          : /linux/.test(lower)
            ? "Linux"
            : "Unknown";

  const browser_name = /edg\//.test(lower)
    ? "Edge"
    : /opr\//.test(lower)
      ? "Opera"
      : /chrome\//.test(lower) && !/edg\//.test(lower) && !/opr\//.test(lower)
        ? "Chrome"
        : /firefox\//.test(lower)
          ? "Firefox"
          : /safari\//.test(lower) && !/chrome\//.test(lower)
            ? "Safari"
            : "Unknown";

  return {
    device_type,
    device_family,
    os_name,
    browser_name,
    user_agent: ua || null,
    screen_width: typeof window !== "undefined" ? window.screen?.width ?? null : null,
    screen_height: typeof window !== "undefined" ? window.screen?.height ?? null : null,
    viewport_width: typeof window !== "undefined" ? window.innerWidth ?? null : null,
    viewport_height: typeof window !== "undefined" ? window.innerHeight ?? null : null,
    language: typeof navigator !== "undefined" ? navigator.language || null : null,
  };
}

export function getStorefrontAnalyticsContext(): StorefrontAnalyticsContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const visitorId = readOrCreateStorageValue(window.localStorage, VISITOR_STORAGE_KEY, "visitor");
    const sessionId = readOrCreateStorageValue(window.sessionStorage, SESSION_STORAGE_KEY, "session");
    const url = new URL(window.location.href);

    return {
      visitor_id: visitorId,
      session_id: sessionId,
      source_host: window.location.host,
      page_url: url.toString(),
      page_path: `${url.pathname}${url.search}`,
      referrer: document.referrer || null,
      utm_source: url.searchParams.get("utm_source"),
      utm_medium: url.searchParams.get("utm_medium"),
      utm_campaign: url.searchParams.get("utm_campaign"),
      utm_term: url.searchParams.get("utm_term"),
      utm_content: url.searchParams.get("utm_content"),
      ...inferClientDeviceContext(),
    };
  } catch {
    return null;
  }
}

function sendEvent(body: Record<string, unknown>) {
  const payload = JSON.stringify(body);

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon("/api/storefront/events", blob);
    return;
  }

  void fetch("/api/storefront/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: payload,
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {});
}

export function trackStorefrontEvent(eventName: StorefrontEventName, payload: StorefrontEventPayload = {}) {
  const context = getStorefrontAnalyticsContext();
  if (!context) {
    return;
  }

  const { device_type, device_family, os_name, browser_name, user_agent, screen_width, screen_height, viewport_width, viewport_height, language, ...rest } = context;

  sendEvent({
    event_name: eventName,
    received_from: "browser",
    ...rest,
    ...payload,
    payload: {
      device_type,
      device_family,
      os_name,
      browser_name,
      user_agent,
      screen_width,
      screen_height,
      viewport_width,
      viewport_height,
      language,
      ...(payload.payload ?? {}),
    },
  });
}

export function trackStorefrontPageView(payload: Pick<StorefrontEventPayload, "payload"> = {}) {
  trackStorefrontEvent("page_view", payload);
}

export function trackStorefrontSearch(query: string, options?: { results_count?: number; ram_filter?: string; storage_filter?: string; sort?: string }) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return;
  }

  trackStorefrontEvent("search", {
    payload: {
      search_query: normalizedQuery,
      results_count: options?.results_count ?? null,
      ram_filter: options?.ram_filter ?? null,
      storage_filter: options?.storage_filter ?? null,
      sort: options?.sort ?? null,
      placement: "storefront_catalog",
    },
  });
}
