/**
 * Telegram Webhook Handler - Operator Assistant
 *
 * This is for YOU (the developer/operator) to control the app via Telegram.
 * NOT for customer sales - that's ManyChat/WhatsApp.
 */

import { FastifyRequest, FastifyReply } from "fastify";
import { config } from "./config.js";
import {
  parseTelegramUpdate,
  extractTelegramMessage,
  isTelegramChatAllowed,
  inferTelegramMessageType,
  extractTelegramTextBody,
  extractTelegramMediaUrl,
  buildTelegramCustomerExternalRef,
  buildTelegramConversationKey,
  buildTelegramConversationTitle,
  getTelegramFileUrl,
  sendTelegramTextMessage,
} from "./telegram.js";
import { streamTelegramResponse, sendThinkingMessage } from "./telegram-streaming.js";
import { pool } from "./db.js";
import { transcribeAudio } from "./sales-agent.js";

export async function handleTelegramWebhook(request: FastifyRequest, reply: FastifyReply) {
  if (!config.TELEGRAM_BOT_TOKEN) {
    return reply.code(503).send({ error: "Telegram is not configured." });
  }

  const secretHeader = request.headers["x-telegram-bot-api-secret-token"];
  const secretValue = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;

  if (config.TELEGRAM_WEBHOOK_SECRET && secretValue !== config.TELEGRAM_WEBHOOK_SECRET) {
    return reply.code(401).send({ error: "Invalid Telegram webhook secret." });
  }

  const update = parseTelegramUpdate(request.body);
  const message = extractTelegramMessage(update);

  if (!message) {
    request.log.info({ update }, "Ignoring Telegram update without message payload");
    return { ok: true, ignored: true, reason: "unsupported-update" };
  }

  if (!isTelegramChatAllowed(message, config.TELEGRAM_ALLOWED_CHAT_IDS)) {
    request.log.info(
      { chatId: message.chat.id, fromId: message.from?.id ?? null },
      "Ignoring Telegram update from disallowed chat"
    );
    return { ok: true, ignored: true, reason: "chat-not-allowed" };
  }

  const messageType = inferTelegramMessageType(message);
  const textBody = extractTelegramTextBody(message);
  const mediaUrl = extractTelegramMediaUrl(message);
  const externalRef = buildTelegramCustomerExternalRef(message);
  const conversationKey = buildTelegramConversationKey(message);
  const conversationTitle = buildTelegramConversationTitle(message);
  const messageAt = new Date(message.date * 1000);

  request.log.info(
    {
      chatId: message.chat.id,
      fromId: message.from?.id ?? null,
      messageId: message.message_id,
      messageType,
      externalRef,
      conversationKey,
      conversationTitle,
    },
    "Processing Telegram webhook update"
  );

  // Extract user message (transcript for audio, text for text)
  let userMessage = textBody || "";
  let transcript: string | undefined = undefined;
  let isAudio = false;

  // Handle audio transcription
  if (messageType === "audio" && (message.voice || message.audio)) {
    isAudio = true;
    const file = message.voice || message.audio;
    
    if (file?.file_id && config.TELEGRAM_BOT_TOKEN) {
      try {
        const fileUrl = await getTelegramFileUrl(file.file_id, config.TELEGRAM_BOT_TOKEN);
        transcript = await transcribeAudio(file.file_id, fileUrl);
        userMessage = transcript;
      } catch (error) {
        console.error("Audio transcription failed:", error);
        userMessage = "(audio - transcription failed)";
        transcript = undefined;
      }
    }
  }

  // Send thinking message first
  const thinkingMsgId = await sendThinkingMessage(
    message.chat.id,
    config.TELEGRAM_BOT_TOKEN,
    message.message_id
  );

  // Build system prompt - respond in USER's language, not forced Spanish
  const systemPrompt = `You are the personal assistant of the TechnoStore developer.
Respond in the SAME LANGUAGE the user writes to you.
- If they write in Spanish → respond in Spanish
- If they write in English → respond in English
- If they write in Russian → respond in Russian
- etc.

Be natural, direct, and technical when needed. Like a teammate, not corporate.
You can help with:
- Database queries
- System status
- App commands
- Products, customers, sales info
- Debugging and logs

If you don't understand, ask. If you don't have the info, say so.`;

  // Handle images with vision model (download and convert to base64)
  let imageBase64: string | undefined = undefined;
  if (messageType === "image" && message.photo && message.photo.length > 0) {
    const photo = message.photo[message.photo.length - 1];
    try {
      const fileUrl = await getTelegramFileUrl(photo.file_id, config.TELEGRAM_BOT_TOKEN);
      const imageResponse = await fetch(fileUrl);
      const arrayBuffer = await imageResponse.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      imageBase64 = `data:image/jpeg;base64,${base64}`;
    } catch (err) {
      request.log.warn({ err }, "Failed to download image for vision model");
    }
  }

  // Stream the response
  const prompt = `User message: "${userMessage}"
${imageBase64 ? '[User sent an image - describe it if relevant]' : ''}

Context: You are the developer's assistant for TechnoStore. Help them with what they need.`;

  const responseText = await streamTelegramResponse({
    chatId: message.chat.id,
    messageId: thinkingMsgId || message.message_id,
    botToken: config.TELEGRAM_BOT_TOKEN,
    prompt: prompt,
    systemPrompt: systemPrompt,
    imageUrl: imageBase64,
  });

  // Save message to DB (optional, for history)
  try {
    await pool.query(
      `INSERT INTO messages (conversation_id, direction, sender_kind, message_type, text_body, created_at)
       VALUES (
         (SELECT id FROM conversations WHERE channel_thread_key = $1 LIMIT 1),
         'inbound',
         'customer',
         $2,
         $3,
         NOW()
       )
       ON CONFLICT DO NOTHING`,
      [conversationKey, messageType, textBody || mediaUrl]
    );
  } catch (err) {
    request.log.warn({ err }, "Failed to save inbound message");
  }

  return {
    ok: true,
    replied: true,
    responseText,
  };
}
