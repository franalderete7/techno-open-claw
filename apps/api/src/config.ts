import "dotenv/config";
import { z } from "zod";

const csvStringArray = z.preprocess((value) => {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}, z.array(z.string()));

const configSchema = z.object({
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_BEARER_TOKEN: z.string().min(1, "API_BEARER_TOKEN is required"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("qwen3.5:cloud"),
  GROQ_API_KEY: z.string().default(""),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_ALLOWED_CHAT_IDS: csvStringArray,
  TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
  TELEGRAM_WEBHOOK_BASE_URL: z.string().default(""),
  MANYCHAT_API_KEY: z.string().default(""),
  MANYCHAT_ACCOUNT_ID: z.string().default(""),
});

export const config = configSchema.parse(process.env);
