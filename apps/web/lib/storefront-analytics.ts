"use client";

type StorefrontEventName = "page_view" | "view_content" | "contact" | "initiate_checkout";

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

export function getStorefrontAnalyticsContext() {
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

  sendEvent({
    event_name: eventName,
    received_from: "browser",
    ...context,
    ...payload,
  });
}

export function trackStorefrontPageView(payload: Pick<StorefrontEventPayload, "payload"> = {}) {
  trackStorefrontEvent("page_view", payload);
}
