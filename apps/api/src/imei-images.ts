import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { z } from "zod";
import { query } from "./db.js";
import { ollamaGenerate } from "./ollama.js";
import { resolveMediaFilePath } from "./media-storage.js";

const extractedImageDeviceSchema = z.object({
  imei_1: z.string().trim().nullable().optional(),
  imei_2: z.string().trim().nullable().optional(),
  serial_number: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

const extractedImagePayloadSchema = z.object({
  devices: z.array(extractedImageDeviceSchema).default([]),
  warnings: z.array(z.string().trim()).default([]),
});

type RecentImageRow = {
  id: number;
  direction: "inbound" | "outbound" | "system";
  sender_kind: "customer" | "tool" | "admin" | "system";
  message_type: "text" | "audio" | "image" | "video" | "file" | "event";
  media_url: string | null;
  created_at: string;
  payload: Record<string, unknown>;
};

export type TelegramImageBatchItem = {
  message_id: number;
  created_at: string;
  media_url: string;
  base64: string;
};

export type ExtractedStockCandidate = {
  imei_1: string | null;
  imei_2: string | null;
  serial_number: string | null;
  source_message_id: number;
  source_media_url: string;
  notes: string | null;
};

function normalizeDigits(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, "");
  return digits || null;
}

function isValidLuhn(value: string) {
  let sum = 0;
  let shouldDouble = false;

  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (!Number.isFinite(digit)) {
      return false;
    }

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function normalizeImei(value: string | null | undefined) {
  const digits = normalizeDigits(value);
  if (!digits || digits.length !== 15 || !isValidLuhn(digits)) {
    return null;
  }

  return digits;
}

function mediaUrlToWildcardPath(mediaUrl: string) {
  try {
    const parsed = new URL(mediaUrl);
    return parsed.pathname.replace(/^\/media\//, "");
  } catch {
    return mediaUrl.replace(/^\/media\//, "");
  }
}

async function readImageBase64(mediaUrl: string) {
  const wildcardPath = mediaUrlToWildcardPath(mediaUrl);
  const filePath = resolveMediaFilePath(wildcardPath);
  if (!filePath) {
    return null;
  }

  const buffer = await readFile(filePath);
  return buffer.toString("base64");
}

function pickLatestImageBlock(rows: RecentImageRow[], maxImages: number) {
  const images: RecentImageRow[] = [];
  let started = false;

  for (const row of rows) {
    if (row.direction !== "inbound" || row.sender_kind !== "customer") {
      if (started) {
        break;
      }

      continue;
    }

    if (row.message_type === "image" && row.media_url) {
      images.push(row);
      started = true;
      if (images.length >= maxImages) {
        break;
      }
      continue;
    }

    if (started) {
      break;
    }
  }

  return images.reverse();
}

export async function countRecentTelegramImageBatch(conversationId?: number) {
  const rows = await query<RecentImageRow>(
    `
      select id, direction, sender_kind, message_type, media_url, created_at, payload
      from public.messages
      ${conversationId ? "where conversation_id = $1" : ""}
      order by created_at desc, id desc
      limit 30
    `,
    conversationId ? [conversationId] : []
  );

  return pickLatestImageBlock(rows, 20).length;
}

export async function loadRecentTelegramImageBatch(conversationId: number, maxImages = 20): Promise<TelegramImageBatchItem[]> {
  const rows = await query<RecentImageRow>(
    `
      select id, direction, sender_kind, message_type, media_url, created_at, payload
      from public.messages
      where conversation_id = $1
      order by created_at desc, id desc
      limit 40
    `,
    [conversationId]
  );

  const selected = pickLatestImageBlock(rows, maxImages);
  const loaded = await Promise.all(
    selected.map(async (row) => {
      if (!row.media_url) {
        return null;
      }

      const base64 = await readImageBase64(row.media_url);
      const rawMessageId = row.payload?.telegramMessageId;
      const messageId =
        typeof rawMessageId === "number"
          ? rawMessageId
          : typeof rawMessageId === "string" && /^\d+$/.test(rawMessageId)
            ? Number(rawMessageId)
            : row.id;

      if (!base64) {
        return null;
      }

      return {
        message_id: messageId,
        created_at: row.created_at,
        media_url: row.media_url,
        base64,
      };
    })
  );

  return loaded.filter((item): item is TelegramImageBatchItem => item != null);
}

async function extractDevicesFromSingleImage(image: TelegramImageBatchItem) {
  const raw = await ollamaGenerate({
    format: "json",
    system: [
      "You extract smartphone IMEIs and serial numbers from inventory photos.",
      "Return strict JSON only.",
      "Schema: {\"devices\":[{\"imei_1\":string|null,\"imei_2\":string|null,\"serial_number\":string|null,\"notes\":string|null}],\"warnings\":[string]}",
      "Rules:",
      "- One device object per label / box / handset visible.",
      "- IMEIs should contain digits only if visible.",
      "- If there is only one IMEI, put it in imei_1.",
      "- If nothing legible is visible, return devices as [].",
    ].join("\n"),
    prompt: "Extract all device identifiers from this image.",
    images: [image.base64],
    options: {
      temperature: 0.1,
      top_p: 0.9,
    },
  });

  const payload = extractedImagePayloadSchema.parse(JSON.parse(raw.response || "{}"));
  return payload;
}

export async function extractStockCandidatesFromRecentImages(conversationId: number, maxImages = 20): Promise<{
  images: TelegramImageBatchItem[];
  candidates: ExtractedStockCandidate[];
  warnings: string[];
}> {
  const images = await loadRecentTelegramImageBatch(conversationId, maxImages);
  const warnings: string[] = [];
  const candidates: ExtractedStockCandidate[] = [];
  const seenImeis = new Set<string>();

  for (const image of images) {
    const extracted = await extractDevicesFromSingleImage(image);
    warnings.push(...extracted.warnings.map((warning) => `img ${image.message_id}: ${warning}`));

    if (extracted.devices.length === 0) {
      warnings.push(`img ${image.message_id}: no encontré IMEIs legibles.`);
      continue;
    }

    for (const device of extracted.devices) {
      const imei1 = normalizeImei(device.imei_1 ?? null);
      const imei2 = normalizeImei(device.imei_2 ?? null);
      const serialNumber = device.serial_number?.trim() || null;

      if (!imei1 && !imei2 && !serialNumber) {
        warnings.push(`img ${image.message_id}: descarté un dispositivo sin IMEI ni serial confiable.`);
        continue;
      }

      const uniqueImeis = [imei1, imei2].filter((imei): imei is string => Boolean(imei));
      const duplicateImei = uniqueImeis.find((imei) => seenImeis.has(imei));
      if (duplicateImei) {
        warnings.push(`img ${image.message_id}: IMEI duplicado en el lote ${duplicateImei}.`);
        continue;
      }

      uniqueImeis.forEach((imei) => seenImeis.add(imei));

      candidates.push({
        imei_1: imei1,
        imei_2: imei2 && imei2 !== imei1 ? imei2 : null,
        serial_number: serialNumber,
        source_message_id: image.message_id,
        source_media_url: image.media_url,
        notes: device.notes?.trim() || null,
      });
    }
  }

  return { images, candidates, warnings };
}
