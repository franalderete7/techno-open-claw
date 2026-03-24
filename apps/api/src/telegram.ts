import { z } from "zod";

const telegramUserSchema = z.object({
  id: z.number().finite(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
});

const telegramChatSchema = z.object({
  id: z.number().finite(),
  type: z.string(),
  title: z.string().optional(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});

const telegramFileSchema = z.object({
  file_id: z.string().min(1),
});

const telegramPhotoSchema = z.object({
  file_id: z.string().min(1),
  file_unique_id: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  file_size: z.number().optional(),
});

const telegramMessageSchema = z.object({
  message_id: z.number().int(),
  date: z.number().int(),
  chat: telegramChatSchema,
  from: telegramUserSchema.optional(),
  text: z.string().optional(),
  caption: z.string().optional(),
  voice: telegramFileSchema.optional(),
  audio: telegramFileSchema.optional(),
  video: telegramFileSchema.optional(),
  video_note: telegramFileSchema.optional(),
  document: telegramFileSchema.optional(),
  photo: z.array(telegramPhotoSchema).optional(),
});

const telegramUpdateSchema = z.object({
  update_id: z.number().int().optional(),
  message: telegramMessageSchema.optional(),
  edited_message: telegramMessageSchema.optional(),
  channel_post: telegramMessageSchema.optional(),
  edited_channel_post: telegramMessageSchema.optional(),
});

export type TelegramMessage = z.infer<typeof telegramMessageSchema>;
export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export interface TelegramBotProfile {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export interface TelegramWebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
}

interface TelegramApiEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export function parseTelegramUpdate(body: unknown) {
  return telegramUpdateSchema.parse(body);
}

export function extractTelegramMessage(update: TelegramUpdate) {
  return update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post ?? null;
}

export function isTelegramChatAllowed(message: TelegramMessage, allowedChatIds: string[]) {
  if (allowedChatIds.length === 0) {
    return true;
  }

  const allowed = new Set(allowedChatIds);
  const chatId = String(message.chat.id);
  const userId = message.from ? String(message.from.id) : null;

  return allowed.has(chatId) || (userId != null && allowed.has(userId));
}

export function inferTelegramMessageType(message: TelegramMessage) {
  if (message.voice || message.audio) {
    return "audio" as const;
  }

  if (message.video || message.video_note) {
    return "video" as const;
  }

  if (message.photo && message.photo.length > 0) {
    return "image" as const;
  }

  if (message.document) {
    return "file" as const;
  }

  return "text" as const;
}

export function extractTelegramMediaUrl(message: TelegramMessage) {
  if (message.voice?.file_id) {
    return `telegram://voice/${message.voice.file_id}`;
  }

  if (message.audio?.file_id) {
    return `telegram://audio/${message.audio.file_id}`;
  }

  if (message.video?.file_id) {
    return `telegram://video/${message.video.file_id}`;
  }

  if (message.video_note?.file_id) {
    return `telegram://video-note/${message.video_note.file_id}`;
  }

  if (message.document?.file_id) {
    return `telegram://document/${message.document.file_id}`;
  }

  if (message.photo && message.photo.length > 0) {
    return `telegram://photo/${message.photo[message.photo.length - 1]?.file_id}`;
  }

  return null;
}

export function extractTelegramTextBody(message: TelegramMessage) {
  return message.text?.trim() || message.caption?.trim() || null;
}

export function buildTelegramCustomerExternalRef(message: TelegramMessage) {
  return `telegram-user:${message.from?.id ?? message.chat.id}`;
}

export function buildTelegramConversationKey(message: TelegramMessage) {
  return `telegram-chat:${message.chat.id}`;
}

export function buildTelegramConversationTitle(message: TelegramMessage) {
  if (message.chat.title?.trim()) {
    return message.chat.title.trim();
  }

  const first = message.chat.first_name?.trim();
  const last = message.chat.last_name?.trim();
  const fullName = [first, last].filter(Boolean).join(" ").trim();

  if (fullName) {
    return fullName;
  }

  if (message.chat.username?.trim()) {
    return `@${message.chat.username.trim()}`;
  }

  if (message.from?.username?.trim()) {
    return `@${message.from.username.trim()}`;
  }

  return `Telegram ${message.chat.id}`;
}

export function buildTelegramWebhookTargetUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, "")}/webhooks/telegram`;
}

async function telegramApiRequest<T>(
  botToken: string,
  method: string,
  body?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Telegram API ${method} failed: ${response.status}`);
  }

  const data = (await response.json()) as TelegramApiEnvelope<T>;
  if (!data.ok || data.result == null) {
    throw new Error(`Telegram API ${method} error: ${data.description || "unknown error"}`);
  }

  return data.result;
}

export async function getTelegramFileUrl(fileId: string, botToken: string): Promise<string> {
  const data = await telegramApiRequest<{ file_path?: string }>(botToken, "getFile", {
    file_id: fileId,
  });

  if (!data.file_path) {
    throw new Error("Failed to get Telegram file URL: missing file_path");
  }

  return `https://api.telegram.org/file/bot${botToken}/${data.file_path}`;
}

export async function getTelegramBotProfile(botToken: string) {
  return telegramApiRequest<TelegramBotProfile>(botToken, "getMe");
}

export async function getTelegramWebhookInfo(botToken: string) {
  return telegramApiRequest<TelegramWebhookInfo>(botToken, "getWebhookInfo");
}

export async function setTelegramWebhook(
  botToken: string,
  options: {
    url: string;
    secretToken?: string;
  }
) {
  return telegramApiRequest<true>(botToken, "setWebhook", {
    url: options.url,
    secret_token: options.secretToken || undefined,
    allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"],
    drop_pending_updates: false,
  });
}

export async function deleteTelegramWebhook(botToken: string) {
  return telegramApiRequest<true>(botToken, "deleteWebhook", {
    drop_pending_updates: false,
  });
}

export async function sendTelegramTextMessage(options: {
  botToken: string;
  chatId: number | string;
  text: string;
  replyToMessageId?: number;
}) {
  return telegramApiRequest<{ message_id: number }>(options.botToken, "sendMessage", {
    chat_id: options.chatId,
    text: options.text.slice(0, 4000),
    reply_to_message_id: options.replyToMessageId,
    allow_sending_without_reply: true,
    disable_web_page_preview: true,
  });
}
