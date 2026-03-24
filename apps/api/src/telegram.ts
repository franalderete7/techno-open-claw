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
