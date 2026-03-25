import { config } from "./config.js";

type OllamaGenerateParams = {
  prompt: string;
  system?: string;
  format?: "json";
  images?: string[];
  options?: Record<string, unknown>;
};

const DEFAULT_OLLAMA_BASE_URLS = [
  "http://host.docker.internal:11434",
  "http://172.17.0.1:11434",
  "http://127.0.0.1:11434",
];

let cachedWorkingBaseUrl: string | null = null;

function uniqueBaseUrls(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

export function getOllamaBaseUrlCandidates() {
  const configured = (process.env.OLLAMA_BASE_URL || config.OLLAMA_BASE_URL || "").trim();
  return uniqueBaseUrls([cachedWorkingBaseUrl || "", configured, ...DEFAULT_OLLAMA_BASE_URLS]);
}

export async function ollamaGenerate(params: OllamaGenerateParams) {
  const body: Record<string, unknown> = {
    model: config.OLLAMA_MODEL,
    stream: false,
    prompt: params.prompt,
    options: params.options || {
      temperature: 0.2,
      top_p: 0.9,
    },
  };

  if (params.system) {
    body.system = params.system;
  }

  if (params.format) {
    body.format = params.format;
  }

  if (params.images && params.images.length > 0) {
    body.images = params.images;
  }

  const candidates = getOllamaBaseUrlCandidates();
  let lastError: unknown = null;

  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        lastError = new Error(`ollama generate failed via ${baseUrl}: ${response.status}`);
        continue;
      }

      const raw = (await response.json()) as { response?: string };
      cachedWorkingBaseUrl = baseUrl;
      return {
        baseUrl,
        response: String(raw.response || ""),
      };
    } catch (error) {
      lastError = error;
    }
  }

  const reason = lastError instanceof Error ? lastError.message : "unknown error";
  throw new Error(`OpenClaw model is unreachable. Tried ${candidates.join(", ")}. Last error: ${reason}`);
}
