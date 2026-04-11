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
  /** Set all three to upload Telegram /media images to Cloudinary with public_id `{folder}/{sku}`. */
  CLOUDINARY_CLOUD_NAME: z.string().default(""),
  CLOUDINARY_API_KEY: z.string().default(""),
  CLOUDINARY_API_SECRET: z.string().default(""),
  /** Folder prefix for product image public_id (no leading/trailing slash). */
  CLOUDINARY_PRODUCTS_FOLDER: z.string().default("assets"),
  OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("qwen3.5:cloud"),
  GROQ_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
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
  TALO_API_BASE_URL: z.string().default(""),
  TALO_USER_ID: z.string().default(""),
  TALO_CLIENT_ID: z.string().default(""),
  TALO_CLIENT_SECRET: z.string().default(""),
  TALO_WEBHOOK_URL: z.string().default(""),
  TALO_REDIRECT_URL: z.string().default(""),
  TALO_SANDBOX: envBoolean.default(false),
  META_APP_ID: z.string().default(""),
  META_APP_SECRET: z.string().default(""),
  META_ACCESS_TOKEN: z.string().default(process.env.META_ADS_ACCESS_TOKEN ?? ""),
  META_AD_ACCOUNT_ID: z.string().default(
    process.env.META_AD_ACCOUNT_IDS
      ?.split(",")
      .map((entry) => entry.trim())
      .find(Boolean) ?? ""
  ),
  META_BUSINESS_ID: z.string().default(""),
  META_CATALOG_ID: z.string().default(""),
  META_PIXEL_ID: z.string().default(""),
  META_CATALOG_FEED_TOKEN: z.string().default(""),
  META_TEST_EVENT_CODE: z.string().default(""),
  META_API_VERSION: z.string().default("v25.0"),
  META_GRAPH_API_BASE: z.string().default("https://graph.facebook.com"),
});

export const config = configSchema.parse(process.env);
