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
import { transcribeAudio } from "./sales-agent.js";
import { storeTelegramImage } from "./media-storage.js";
import { handleTelegramOperatorMessage, renderOperatorChatReply } from "./telegram-operator.js";
import { sendThinkingMessage, streamTelegramResponse } from "./telegram-streaming.js";
import {
  saveConversationMessage,
  saveTelegramInboundMessage,
  upsertTelegramConversation,
  upsertTelegramCustomer,
} from "./telegram-storage.js";

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
  let mediaUrl = extractTelegramMediaUrl(message);
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

  // Handle audio transcription
  if (messageType === "audio" && (message.voice || message.audio)) {
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

  let imageBase64: string | undefined = undefined;
  let attachedImageUrl: string | undefined = undefined;
  if (messageType === "image" && message.photo && message.photo.length > 0) {
    const photo = message.photo[message.photo.length - 1];

    try {
      const fileUrl = await getTelegramFileUrl(photo.file_id, config.TELEGRAM_BOT_TOKEN);
      const imageResponse = await fetch(fileUrl);
      if (!imageResponse.ok) {
        throw new Error(`Telegram image download failed: ${imageResponse.status}`);
      }
      const arrayBuffer = await imageResponse.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);
      imageBase64 = `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;

      const storedImage = await storeTelegramImage({
        chatId: message.chat.id,
        messageId: message.message_id,
        sourceFileUrl: fileUrl,
        buffer: imageBuffer,
      });
      attachedImageUrl = storedImage.publicUrl;
      mediaUrl = storedImage.publicUrl;
    } catch (error) {
      request.log.warn({ error }, "Failed to load Telegram image for operator context");
    }
  }

  const customerId = await upsertTelegramCustomer({
    externalRef,
    firstName: message.from?.first_name?.trim() || message.chat.first_name?.trim() || null,
    lastName: message.from?.last_name?.trim() || message.chat.last_name?.trim() || null,
  });

  const conversationId = await upsertTelegramConversation({
    customerId,
    conversationKey,
    conversationTitle,
    messageAt,
  });

  const inbound = await saveTelegramInboundMessage({
    conversationId,
    messageType,
    textBody: textBody || userMessage || null,
    mediaUrl,
    transcript: transcript ?? null,
    payload: {
      updateId: update.update_id ?? null,
      telegramMessageId: message.message_id,
      chatId: message.chat.id,
    },
  });

  if (inbound.duplicate) {
    request.log.info(
      {
        chatId: message.chat.id,
        messageId: message.message_id,
        conversationId,
        inboundMessageId: inbound.id,
      },
      "Skipping duplicate Telegram webhook update"
    );

    return {
      ok: true,
      duplicate: true,
    };
  }

  void (async () => {
    try {
      const operatorResult = await handleTelegramOperatorMessage({
        actorRef: `telegram:${message.chat.id}:${message.from?.id ?? message.chat.id}`,
        chatId: String(message.chat.id),
        chatIdNumber: message.chat.id,
        userId: message.from ? String(message.from.id) : null,
        userMessage,
        imageBase64,
        attachedImageUrl,
      });

      let responseText = "";
      let telegramMessageId: number | null = null;

      if (operatorResult.kind === "chat") {
        const thinkingMessageId = await sendThinkingMessage(
          message.chat.id,
          config.TELEGRAM_BOT_TOKEN,
          message.message_id
        );

        if (thinkingMessageId) {
          telegramMessageId = thinkingMessageId;
          responseText = await streamTelegramResponse({
            chatId: message.chat.id,
            messageId: thinkingMessageId,
            botToken: config.TELEGRAM_BOT_TOKEN,
            prompt: operatorResult.prompt,
            systemPrompt: operatorResult.systemPrompt,
            imageUrl: imageBase64,
          });
        } else {
          responseText = await renderOperatorChatReply({
            systemPrompt: operatorResult.systemPrompt,
            prompt: operatorResult.prompt,
            imageBase64,
          });
          const telegramResponse = await sendTelegramTextMessage({
            botToken: config.TELEGRAM_BOT_TOKEN,
            chatId: message.chat.id,
            text: responseText,
            replyToMessageId: message.message_id,
          });
          telegramMessageId = telegramResponse.message_id;
        }
      } else {
        responseText = operatorResult.text.trim() || "No pude preparar una respuesta útil.";
        const telegramResponse = await sendTelegramTextMessage({
          botToken: config.TELEGRAM_BOT_TOKEN,
          chatId: message.chat.id,
          text: responseText,
          replyToMessageId: message.message_id,
        });
        telegramMessageId = telegramResponse.message_id;
      }

      await saveConversationMessage({
        conversationId,
        direction: "outbound",
        senderKind: "tool",
        messageType: "text",
        textBody: responseText,
        payload: {
          source: operatorResult.kind === "chat" ? "telegram-stream" : "telegram-operator",
          telegramMessageId: telegramMessageId,
        },
      });

      request.log.info(
        {
          chatId: message.chat.id,
          inboundMessageId: inbound.id,
          outboundTelegramMessageId: telegramMessageId,
          streamed: operatorResult.kind === "chat",
        },
        "Telegram operator reply sent"
      );
    } catch (error) {
      request.log.error({ error }, "Telegram operator flow failed");

      const fallbackText = error instanceof Error ? error.message : "No pude procesar esa instrucción.";

      try {
        const telegramResponse = await sendTelegramTextMessage({
          botToken: config.TELEGRAM_BOT_TOKEN,
          chatId: message.chat.id,
          text: fallbackText,
          replyToMessageId: message.message_id,
        });

        await saveConversationMessage({
          conversationId,
          direction: "outbound",
          senderKind: "tool",
          messageType: "text",
          textBody: fallbackText,
          payload: {
            source: "telegram-error",
            telegramMessageId: telegramResponse.message_id,
          },
        });
      } catch (sendError) {
        request.log.error({ error: sendError }, "Failed to send Telegram error reply");
      }
    }
  })();

  return {
    ok: true,
    accepted: true,
  };
}
