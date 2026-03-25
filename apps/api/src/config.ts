import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const currentDir = dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  resolve(process.cwd(), ".env"),
  resolve(currentDir, "../../../.env"),
];

for (const envPath of envCandidates) {
  if (!existsSync(envPath)) {
    continue;
  }

  dotenv.config({ path: envPath });
  break;
}

const csvStringArray = z.preprocess((value) => {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}, z.array(z.string()));

const envBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return false;
  }

  return ["1", "true", "yes", "si", "sí", "y"].includes(value.trim().toLowerCase());
}, z.boolean());

const configSchema = z.object({
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_BEARER_TOKEN: z.string().min(1, "API_BEARER_TOKEN is required"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  UPLOADS_DIR: z.string().default(resolve(process.cwd(), "data/uploads")),
  PUBLIC_API_BASE_URL: z.string().default(""),
  OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("qwen3.5:cloud"),
  GROQ_API_KEY: z.string().default(""),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_ALLOWED_CHAT_IDS: csvStringArray,
  TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
  TELEGRAM_WEBHOOK_BASE_URL: z.string().default(""),
  MANYCHAT_API_KEY: z.string().default(""),
  MANYCHAT_ACCOUNT_ID: z.string().default(""),
  STORE_WHATSAPP_PHONE: z.string().default("543875319940"),
  GALIOPAY_API_BASE_URL: z.string().default("https://pay.galio.app"),
  GALIOPAY_CLIENT_ID: z.string().default(""),
  GALIOPAY_API_KEY: z.string().default(""),
  GALIOPAY_NOTIFICATION_URL: z.string().default(""),
  GALIOPAY_SUCCESS_URL: z.string().default(""),
  GALIOPAY_FAILURE_URL: z.string().default(""),
  GALIOPAY_SANDBOX: envBoolean.default(false),
});

export const config = configSchema.parse(process.env);
