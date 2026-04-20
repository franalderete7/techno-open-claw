import { existsSync } from "node:fs";

export function normalizeApiBaseUrl(rawUrl: string) {
  if (existsSync("/.dockerenv")) {
    return rawUrl;
  }

  try {
    const url = new URL(rawUrl);

    if (url.hostname === "api") {
      url.hostname = "127.0.0.1";
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return rawUrl;
  }
}

const apiBaseUrl = normalizeApiBaseUrl(process.env.INTERNAL_API_BASE_URL || "http://127.0.0.1:4000");
const apiBearerToken = process.env.INTERNAL_API_BEARER_TOKEN || "";

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${apiBearerToken}`);

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    cache: "no-store",
    ...init,
    headers,
  });

  const text = await response.text();
  if (!response.ok) {
    const hint = text.trim().slice(0, 500) || response.statusText;
    throw new Error(`API ${response.status} ${path}: ${hint}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`API devolvió respuesta no-JSON (${path}). ¿INTERNAL_API_BASE_URL apunta al OpenClaw API?`);
  }
}

async function apiFetch<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export type DashboardResponse = {
  customers: number;
  openConversations: number;
  messages: number;
};

export type ListResponse<T> = {
  items: T[];
};

export type CustomerRecord = {
  id: number;
  external_ref: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ConversationRecord = {
  id: number;
  channel: string;
  channel_thread_key: string;
  status: string;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  customer_id: number | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
};

export type ConversationMessageRecord = {
  id: number;
  direction: string;
  sender_kind: string;
  message_type: string;
  text_body: string | null;
  media_url: string | null;
  transcript: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export async function getDashboard() {
  return apiFetch<DashboardResponse>("/v1/dashboard");
}

export async function getCustomers(limit = 50) {
  return apiFetch<ListResponse<CustomerRecord>>(`/v1/customers?limit=${limit}`);
}

export async function getConversations(limit = 50) {
  return apiFetch<ListResponse<ConversationRecord>>(`/v1/conversations?limit=${limit}`);
}

export async function getConversationMessages(conversationId: number) {
  return apiFetch<ListResponse<ConversationMessageRecord>>(`/v1/conversations/${conversationId}/messages`);
}
