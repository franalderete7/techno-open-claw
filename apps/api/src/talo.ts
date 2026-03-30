import { config } from "./config.js";

type CreateTaloPaymentParams = {
  externalId: string;
  title: string;
  unitPrice: number;
  currencyCode: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  webhookUrl?: string | null;
  redirectUrl?: string | null;
};

type TaloPaymentResponse = {
  id: string | null;
  status: string | null;
  externalId: string | null;
  paymentUrl: string | null;
  alias: string | null;
  cvu: string | null;
  expirationTimestamp: string | null;
  raw: unknown;
};

type CachedToken = {
  value: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;

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

function pickNestedText(record: Record<string, unknown> | null, path: string[]) {
  let current: unknown = record;

  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function buildTaloUrl(path: string) {
  const base = config.TALO_API_BASE_URL.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function hasTaloConfig() {
  return Boolean(config.TALO_API_BASE_URL && config.TALO_USER_ID && config.TALO_CLIENT_ID && config.TALO_CLIENT_SECRET);
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

async function createTaloToken(forceRefresh = false) {
  if (!hasTaloConfig()) {
    throw new Error("Talo is not configured");
  }

  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const response = await fetch(buildTaloUrl(`/users/${encodeURIComponent(config.TALO_USER_ID)}/tokens`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.TALO_CLIENT_ID,
      client_secret: config.TALO_CLIENT_SECRET,
    }),
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(`Talo auth failed: ${response.status} ${response.statusText}${payload ? ` - ${JSON.stringify(payload)}` : ""}`);
  }

  const record = asRecord(payload);
  const dataRecord = asRecord(record?.data);
  const token =
    pickText(record, "token", "access_token") ||
    pickText(dataRecord, "token", "access_token") ||
    pickNestedText(record, ["data", "token"]);

  if (!token) {
    throw new Error("Talo auth did not return a token");
  }

  cachedToken = {
    value: token,
    expiresAt: Date.now() + 45 * 60 * 1000,
  };

  return token;
}

async function taloRequest(path: string, init: RequestInit, retryOnAuthFailure = true) {
  if (!hasTaloConfig()) {
    throw new Error("Talo is not configured");
  }

  const token = await createTaloToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(buildTaloUrl(path), {
    ...init,
    headers,
  });

  const payload = await readJsonResponse(response);

  if (response.status === 401 && retryOnAuthFailure) {
    cachedToken = null;
    return taloRequest(path, init, false);
  }

  if (!response.ok) {
    throw new Error(`Talo request failed: ${response.status} ${response.statusText}${payload ? ` - ${JSON.stringify(payload)}` : ""}`);
  }

  return payload;
}

function mapTaloPayment(raw: unknown): TaloPaymentResponse {
  const record = asRecord(raw);
  const dataRecord = asRecord(record?.data);
  const transferQuote = asRecord(dataRecord?.transfer_quote);
  const transferDetails = asRecord(dataRecord?.transfer_details);

  return {
    id: pickText(record, "id") || pickText(dataRecord, "id"),
    status: pickText(record, "payment_status", "status") || pickText(dataRecord, "payment_status", "status"),
    externalId:
      pickText(record, "external_id", "externalId") || pickText(dataRecord, "external_id", "externalId"),
    paymentUrl: pickText(record, "payment_url", "paymentUrl") || pickText(dataRecord, "payment_url", "paymentUrl"),
    alias:
      pickText(transferQuote, "alias") ||
      pickText(transferDetails, "alias") ||
      pickNestedText(record, ["data", "transfer_quote", "alias"]),
    cvu:
      pickText(transferQuote, "cvu") ||
      pickText(transferDetails, "cvu") ||
      pickNestedText(record, ["data", "transfer_quote", "cvu"]),
    expirationTimestamp:
      pickText(record, "expiration_timestamp", "expires_at") ||
      pickText(dataRecord, "expiration_timestamp", "expires_at"),
    raw,
  };
}

function splitCustomerName(name: string | null | undefined) {
  const normalized = String(name ?? "").trim();
  if (!normalized) {
    return {
      first_name: undefined,
      last_name: undefined,
    };
  }

  const parts = normalized.split(/\s+/);
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" ") || undefined,
  };
}

export async function createTaloPayment({
  externalId,
  title,
  unitPrice,
  currencyCode,
  customerName,
  customerPhone,
  customerEmail,
  webhookUrl,
  redirectUrl,
}: CreateTaloPaymentParams): Promise<TaloPaymentResponse> {
  const nameParts = splitCustomerName(customerName);
  const payload = {
    user_id: config.TALO_USER_ID,
    price: {
      amount: Math.round(unitPrice),
      currency: currencyCode,
    },
    payment_options: ["transfer"],
    external_id: externalId,
    webhook_url: webhookUrl || undefined,
    redirect_url: redirectUrl || undefined,
    motive: title,
    client_data: {
      ...nameParts,
      phone_number: customerPhone || undefined,
      email: customerEmail || undefined,
    },
  };

  const raw = await taloRequest("/payments", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return mapTaloPayment(raw);
}

export async function getTaloPayment(paymentId: string): Promise<TaloPaymentResponse> {
  const raw = await taloRequest(`/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
  });

  return mapTaloPayment(raw);
}
