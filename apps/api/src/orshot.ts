import { config } from "./config.js";

type OrshotListResponse<T> = {
  data?: T[];
  page?: number;
  limit?: number;
  total?: number;
};

export type OrshotStudioTemplateRecord = {
  id: string;
  name?: string | null;
  category?: string | null;
  width?: number | null;
  height?: number | null;
  updatedAt?: string | null;
};

export type OrshotRenderResponse = {
  id?: string | null;
  url?: string | null;
  format?: string | null;
  width?: number | null;
  height?: number | null;
  metadata?: Record<string, unknown> | null;
};

function normalizeBaseUrl() {
  return (config.ORSHOT_API_BASE_URL.trim() || "https://api.orshot.com").replace(/\/+$/, "");
}

function requireOrshotApiKey() {
  const apiKey = config.ORSHOT_API_KEY.trim();
  if (!apiKey) {
    throw new Error("ORSHOT_API_KEY is required to call Orshot.");
  }

  return apiKey;
}

async function orshotGet<T>(path: string, params?: Record<string, string | number | undefined>) {
  const apiKey = requireOrshotApiKey();
  const url = new URL(`${normalizeBaseUrl()}${path}`);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Orshot GET ${path} failed: ${response.status} ${body}`);
  }

  return (await response.json()) as T;
}

async function orshotPost<T>(path: string, body: unknown) {
  const apiKey = requireOrshotApiKey();
  const response = await fetch(`${normalizeBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Orshot POST ${path} failed: ${response.status} ${text}`);
  }

  return (await response.json()) as T;
}

export function isOrshotConfigured() {
  return Boolean(config.ORSHOT_API_KEY.trim());
}

export async function listOrshotStudioTemplates(options: { page?: number; limit?: number } = {}) {
  const response = await orshotGet<OrshotListResponse<OrshotStudioTemplateRecord>>("/v1/studio/templates/get", {
    page: options.page ?? 1,
    limit: options.limit ?? 50,
  });

  return {
    items: response.data ?? [],
    page: response.page ?? options.page ?? 1,
    limit: response.limit ?? options.limit ?? 50,
    total: response.total ?? (response.data ?? []).length,
  };
}

export async function renderOrshotStudioTemplate(input: {
  templateId: string;
  modifications: Record<string, unknown>;
  format?: string;
  responseType?: "url" | "binary" | "base64";
  webhookUrl?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const response = await orshotPost<OrshotRenderResponse>("/v1/studio/render", {
    template_id: input.templateId,
    modifications: input.modifications,
    format: input.format ?? "png",
    response_type: input.responseType ?? "url",
    webhook_url: input.webhookUrl ?? (config.ORSHOT_WEBHOOK_URL.trim() || undefined),
    metadata: input.metadata ?? undefined,
  });

  return response;
}
