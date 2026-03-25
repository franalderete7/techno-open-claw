import { config } from "./config.js";

type CreateGalioPaymentLinkParams = {
  referenceId: string;
  title: string;
  unitPrice: number;
  currencyCode: string;
  imageUrl?: string | null;
  notificationUrl?: string | null;
  successUrl?: string | null;
  failureUrl?: string | null;
};

type GalioPaymentLinkResponse = {
  url: string;
  proofToken: string | null;
  raw: unknown;
};

type GalioPaymentResponse = {
  id: string | null;
  status: string | null;
  referenceId: string | null;
  raw: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function pickText(record: Record<string, unknown> | null, ...keys: string[]) {
  if (!record) return null;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function buildGalioUrl(path: string) {
  const base = config.GALIOPAY_API_BASE_URL.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function buildNotificationUrl() {
  if (config.GALIOPAY_NOTIFICATION_URL) {
    return config.GALIOPAY_NOTIFICATION_URL;
  }

  if (config.PUBLIC_API_BASE_URL) {
    return `${config.PUBLIC_API_BASE_URL.replace(/\/$/, "")}/webhooks/galiopay`;
  }

  return null;
}

export function hasGalioPayConfig() {
  return Boolean(config.GALIOPAY_CLIENT_ID && config.GALIOPAY_API_KEY);
}

async function readJsonResponse(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function galioRequest(path: string, init: RequestInit) {
  if (!hasGalioPayConfig()) {
    throw new Error("GalioPay is not configured");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${config.GALIOPAY_API_KEY}`);
  headers.set("x-client-id", config.GALIOPAY_CLIENT_ID);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(buildGalioUrl(path), {
    ...init,
    headers,
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      `GalioPay request failed: ${response.status} ${response.statusText}${payload ? ` - ${JSON.stringify(payload)}` : ""}`
    );
  }

  return payload;
}

export async function createGalioPaymentLink({
  referenceId,
  title,
  unitPrice,
  currencyCode,
  imageUrl,
  notificationUrl,
  successUrl,
  failureUrl,
}: CreateGalioPaymentLinkParams): Promise<GalioPaymentLinkResponse> {
  const payload = {
    referenceId,
    sandbox: config.GALIOPAY_SANDBOX,
    notificationUrl: notificationUrl || buildNotificationUrl() || undefined,
    backUrl: {
      success: successUrl || config.GALIOPAY_SUCCESS_URL || undefined,
      failure: failureUrl || config.GALIOPAY_FAILURE_URL || undefined,
    },
    items: [
      {
        title,
        quantity: 1,
        unitPrice: Math.round(unitPrice),
        currencyId: currencyCode,
        imageUrl: imageUrl || undefined,
      },
    ],
  };

  const raw = await galioRequest("/api/payment-links", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const record = asRecord(raw);
  const dataRecord = asRecord(record?.data);
  const url = pickText(record, "url", "paymentUrl", "checkoutUrl") || pickText(dataRecord, "url", "paymentUrl", "checkoutUrl");

  if (!url) {
    throw new Error("GalioPay did not return a payment URL");
  }

  return {
    url,
    proofToken:
      pickText(record, "proofToken", "proof_token") || pickText(dataRecord, "proofToken", "proof_token"),
    raw,
  };
}

export async function getGalioPayment(paymentId: string): Promise<GalioPaymentResponse> {
  const raw = await galioRequest(`/api/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
  });

  const record = asRecord(raw);
  const dataRecord = asRecord(record?.data);

  return {
    id: pickText(record, "id") || pickText(dataRecord, "id"),
    status: pickText(record, "status") || pickText(dataRecord, "status"),
    referenceId: pickText(record, "referenceId", "reference_id") || pickText(dataRecord, "referenceId", "reference_id"),
    raw,
  };
}
