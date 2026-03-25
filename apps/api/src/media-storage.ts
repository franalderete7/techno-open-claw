import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, normalize, resolve, sep } from "node:path";
import { config } from "./config.js";

function normalizePublicBaseUrl() {
  return (
    config.PUBLIC_API_BASE_URL.trim() ||
    config.TELEGRAM_WEBHOOK_BASE_URL.trim() ||
    `http://127.0.0.1:${config.API_PORT}`
  ).replace(/\/+$/, "");
}

export function buildMediaPublicUrl(relativePath: string) {
  const safePath = relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${normalizePublicBaseUrl()}/media/${safePath}`;
}

export function resolveMediaFilePath(requestPath: string) {
  const decodedPath = decodeURIComponent(requestPath || "");
  const sanitizedPath = normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, "");

  if (!sanitizedPath || sanitizedPath.startsWith("..")) {
    return null;
  }

  const uploadsRoot = resolve(config.UPLOADS_DIR);
  const absolutePath = resolve(uploadsRoot, sanitizedPath);

  if (absolutePath !== uploadsRoot && !absolutePath.startsWith(`${uploadsRoot}${sep}`)) {
    return null;
  }

  return absolutePath;
}

export function inferMediaContentType(filePath: string) {
  switch (extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

export function openMediaStream(filePath: string) {
  return createReadStream(filePath);
}

export async function storeTelegramImage(params: {
  chatId: number;
  messageId: number;
  sourceFileUrl: string;
  buffer: Buffer;
}) {
  const parsedExtension = extname(new URL(params.sourceFileUrl).pathname).toLowerCase();
  const extension = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(parsedExtension) ? parsedExtension : ".jpg";
  const relativePath = [
    "telegram",
    "products",
    String(params.chatId),
    `${Date.now()}-${params.messageId}-${randomUUID()}${extension}`,
  ].join("/");
  const absolutePath = resolve(config.UPLOADS_DIR, relativePath);

  await mkdir(resolve(config.UPLOADS_DIR, "telegram", "products", String(params.chatId)), {
    recursive: true,
  });
  await writeFile(absolutePath, params.buffer);

  return {
    relativePath,
    fileName: basename(absolutePath),
    publicUrl: buildMediaPublicUrl(relativePath),
  };
}
