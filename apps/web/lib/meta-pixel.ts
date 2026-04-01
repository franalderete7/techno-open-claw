"use client";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

type MetaProductPayload = {
  sku: string;
  title: string;
  brand: string;
  value: number | null;
  currency?: string;
};

function trackMetaEvent(eventName: string, payload: Record<string, unknown>, eventId?: string) {
  if (typeof window === "undefined" || typeof window.fbq !== "function") {
    return;
  }

  if (eventId) {
    window.fbq("track", eventName, payload, { eventID: eventId });
    return;
  }

  window.fbq("track", eventName, payload);
}

function buildProductEventPayload({ sku, title, brand, value, currency = "ARS" }: MetaProductPayload) {
  return {
    content_ids: [sku],
    content_type: "product",
    contents: [{ id: sku, quantity: 1 }],
    content_name: title,
    content_category: brand,
    currency,
    ...(value != null ? { value } : {}),
  };
}

export function trackMetaViewContent(payload: MetaProductPayload) {
  trackMetaEvent("ViewContent", buildProductEventPayload(payload));
}

export function trackMetaInitiateCheckout(payload: MetaProductPayload) {
  trackMetaEvent("InitiateCheckout", buildProductEventPayload(payload));
}

export function trackMetaContact(payload: MetaProductPayload) {
  trackMetaEvent("Contact", {
    content_name: payload.title,
    content_category: payload.brand,
    content_ids: [payload.sku],
  });
}
