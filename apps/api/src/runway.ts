import { config } from "./config.js";

export type RunwayTaskStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "THROTTLED" | "UNKNOWN";

export type RunwayTaskRecord = {
  id: string;
  status?: RunwayTaskStatus | string | null;
  failure?: string | null;
  output?: Array<{
    url?: string | null;
    contentType?: string | null;
  }> | null;
  progress?: number | null;
};

type RunwayResponseEnvelope<T> = T & Record<string, unknown>;

function normalizeRunwayBaseUrl() {
  return (config.RUNWAY_API_BASE_URL.trim() || "https://api.dev.runwayml.com").replace(/\/+$/, "");
}

function requireRunwayApiKey() {
  const apiKey = config.RUNWAYML_API_SECRET.trim();
  if (!apiKey) {
    throw new Error("RUNWAYML_API_SECRET is required to call Runway.");
  }

  return apiKey;
}

async function runwayRequest<T>(path: string, init?: RequestInit) {
  const apiKey = requireRunwayApiKey();
  const response = await fetch(`${normalizeRunwayBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Runway-Version": config.RUNWAY_API_VERSION.trim() || "2024-11-06",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Runway request ${path} failed: ${response.status} ${text}`);
  }

  return (await response.json()) as RunwayResponseEnvelope<T>;
}

export function isRunwayConfigured() {
  return Boolean(config.RUNWAYML_API_SECRET.trim());
}

export async function createRunwayTextToImageTask(input: {
  promptText: string;
  model?: string;
  ratio?: string;
  seed?: number;
}) {
  return runwayRequest<RunwayTaskRecord>("/v1/text_to_image", {
    method: "POST",
    body: JSON.stringify({
      promptText: input.promptText,
      model: input.model ?? "gen4_image",
      ratio: input.ratio ?? "1024:1024",
      seed: input.seed ?? undefined,
    }),
  });
}

export async function createRunwayImageToVideoTask(input: {
  model?: string;
  promptImage: string;
  promptText?: string;
  ratio?: string;
  duration?: number;
  seed?: number;
}) {
  return runwayRequest<RunwayTaskRecord>("/v1/image_to_video", {
    method: "POST",
    body: JSON.stringify({
      model: input.model ?? "gen4_turbo",
      promptImage: input.promptImage,
      promptText: input.promptText ?? undefined,
      ratio: input.ratio ?? "1280:720",
      duration: input.duration ?? 5,
      seed: input.seed ?? undefined,
    }),
  });
}

export async function getRunwayTask(taskId: string) {
  return runwayRequest<RunwayTaskRecord>(`/v1/tasks/${encodeURIComponent(taskId)}`);
}
