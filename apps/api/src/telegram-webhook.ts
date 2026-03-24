/**
 * Telegram Webhook Handler - Sales Agent Integration
 * 
 * This replaces the inline webhook handler with a modular approach
 * that uses the sales-agent module for turn processing.
 */

import { FastifyRequest, FastifyReply } from "fastify";
import { config } from "./config.js";
import { pool } from "./db.js";
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
} from "./telegram.js";
import { processTurn, saveInboundMessage, transcribeAudio } from "./sales-agent.js";
import { streamTelegramResponse, sendThinkingMessage } from "./telegram-streaming.js";

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
    return { ok: true, ignored: true, reason: "unsupported-update" };
  }

  if (!isTelegramChatAllowed(message, config.TELEGRAM_ALLOWED_CHAT_IDS)) {
    return { ok: true, ignored: true, reason: "chat-not-allowed" };
  }

  const messageType = inferTelegramMessageType(message);
  const textBody = extractTelegramTextBody(message);
  const mediaUrl = extractTelegramMediaUrl(message);
  const externalRef = buildTelegramCustomerExternalRef(message);
  const conversationKey = buildTelegramConversationKey(message);
  const conversationTitle = buildTelegramConversationTitle(message);
  const messageAt = new Date(message.date * 1000);

  // Extract user message (transcript for audio, text for text)
  let userMessage = textBody || "";
  let transcript: string | null = null;
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
        transcript = null;
      }
    }
  }

  // Process the turn through the sales agent
  const turnResult = await processTurn({
    channel: "telegram",
    channel_thread_key: conversationKey,
    user_message: userMessage,
    raw_message: textBody || mediaUrl || "(media)",
    is_audio: isAudio,
    subscriber_id: String(message.chat.id),
    phone: undefined,
    message_date: messageAt.toISOString(),
  });

  // Save the inbound message (now we have the conversation_id from turn processing)
  if (turnResult.conversation_id) {
    await saveInboundMessage({
      conversation_id: turnResult.conversation_id,
      direction: "inbound",
      sender_kind: "customer",
      message_type: messageType,
      text_body: textBody,
      media_url: mediaUrl,
      transcript: transcript,
      payload: update as Record<string, unknown>,
    });
  }

  // Send reply if needed (with streaming for internal dev chat)
  if (turnResult.should_reply && turnResult.reply_text && config.TELEGRAM_BOT_TOKEN) {
    try {
      // For internal dev chat: use streaming like ChatGPT
      // Send "thinking..." first, then stream the response
      const thinkingMsgId = await sendThinkingMessage(
        message.chat.id,
        config.TELEGRAM_BOT_TOKEN,
        message.message_id
      );
      
      if (thinkingMsgId) {
        // Stream the full response
        const systemPrompt = `Eres un asistente de desarrollo para TechnoStore. 
        Tu rol es ayudar al desarrollador a construir features, debuggear, y escribir código.
        Sé técnico, preciso y directo. Usa código cuando sea necesario.`;
        
        await streamTelegramResponse({
          chatId: message.chat.id,
          messageId: thinkingMsgId,
          botToken: config.TELEGRAM_BOT_TOKEN,
          prompt: turnResult.reply_text,
          systemPrompt,
        });
      } else {
        // Fallback: regular sendMessage
        await fetch(
          `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: message.chat.id,
              text: turnResult.reply_text,
              reply_to_message_id: message.message_id,
              parse_mode: "Markdown",
            }),
          }
        );
      }
    } catch (error) {
      console.error("Failed to send Telegram reply:", error);
    }
  }

  return {
    ok: true,
    conversationId: turnResult.conversation_id,
    customerId: turnResult.customer_id,
    messageType,
    turnProcessed: turnResult.state_applied,
    replied: turnResult.should_reply,
  };
}
