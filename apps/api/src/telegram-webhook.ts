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
  extractTelegramCallbackQuery,
  isTelegramChatAllowed,
  isTelegramCallbackAllowed,
  inferTelegramMessageType,
  extractTelegramTextBody,
  extractTelegramMediaUrl,
  buildTelegramCustomerExternalRef,
  buildTelegramConversationKey,
  buildTelegramConversationTitle,
  getTelegramFileUrl,
  sendTelegramMessage,
  sendTelegramTextMessages,
  answerTelegramCallbackQuery,
  clearTelegramInlineKeyboard,
} from "./telegram.js";
import { transcribeAudio } from "./sales-agent.js";
import { storeTelegramImage } from "./media-storage.js";
import { formatOperatorError, handleTelegramOperatorMessage, renderOperatorChatReply } from "./telegram-operator.js";
import { sendThinkingMessage, streamTelegramResponse } from "./telegram-streaming.js";
import {
  saveConversationMessage,
  saveTelegramInboundMessage,
  upsertTelegramConversation,
  upsertTelegramCustomer,
} from "./telegram-storage.js";

function parseOperatorCallbackData(data: string | undefined) {
  if (!data) {
    return null;
  }

  const match = data.match(/^op:(approve|cancel|edit|menu|pick):(.+)$/);
  if (!match) {
    return null;
  }

  return {
    action: match[1] as "approve" | "cancel" | "edit" | "menu" | "pick",
    value: match[2],
  };
}

async function dispatchOperatorTelegramReply(params: {
  chatId: number;
  replyToMessageId?: number;
  operatorResult: Awaited<ReturnType<typeof handleTelegramOperatorMessage>>;
  imageBase64?: string;
}) {
  let responseText = "";
  let telegramMessageId: number | null = null;
  let telegramMessageIds: number[] = [];
  let source = "telegram-operator";

  if (params.operatorResult.kind === "chat") {
    const thinkingMessageId = await sendThinkingMessage(
      params.chatId,
      config.TELEGRAM_BOT_TOKEN,
      params.replyToMessageId
    );

    source = "telegram-stream";
    if (thinkingMessageId) {
      telegramMessageId = thinkingMessageId;
      responseText = await streamTelegramResponse({
        chatId: params.chatId,
        messageId: thinkingMessageId,
        botToken: config.TELEGRAM_BOT_TOKEN,
        prompt: params.operatorResult.prompt,
        systemPrompt: params.operatorResult.systemPrompt,
        imageUrl: params.imageBase64,
      });
    } else {
      responseText = await renderOperatorChatReply({
        systemPrompt: params.operatorResult.systemPrompt,
        prompt: params.operatorResult.prompt,
        imageBase64: params.imageBase64,
      });
      const telegramResponses = await sendTelegramTextMessages({
        botToken: config.TELEGRAM_BOT_TOKEN,
        chatId: params.chatId,
        text: responseText,
        replyToMessageId: params.replyToMessageId,
      });
      telegramMessageIds = telegramResponses.map((item) => item.message_id);
      telegramMessageId = telegramMessageIds[0] ?? null;
    }
  } else {
    responseText = params.operatorResult.text.trim() || "No pude preparar una respuesta útil.";

    if (params.operatorResult.buttons || params.operatorResult.forceReply) {
      const telegramResponse = await sendTelegramMessage({
        botToken: config.TELEGRAM_BOT_TOKEN,
        chatId: params.chatId,
        text: responseText,
        replyToMessageId: params.replyToMessageId,
        buttons: params.operatorResult.buttons,
        forceReply: params.operatorResult.forceReply,
      });
      telegramMessageId = telegramResponse.message_id;
      telegramMessageIds = [telegramResponse.message_id];
    } else {
      const telegramResponses = await sendTelegramTextMessages({
        botToken: config.TELEGRAM_BOT_TOKEN,
        chatId: params.chatId,
        text: responseText,
        replyToMessageId: params.replyToMessageId,
      });
      telegramMessageIds = telegramResponses.map((item) => item.message_id);
      telegramMessageId = telegramMessageIds[0] ?? null;
    }
  }

  return {
    responseText,
    telegramMessageId,
    telegramMessageIds,
    source,
  };
}

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
  const callbackQuery = extractTelegramCallbackQuery(update);
  const message = extractTelegramMessage(update);

  if (callbackQuery) {
    if (!isTelegramCallbackAllowed(callbackQuery, config.TELEGRAM_ALLOWED_CHAT_IDS)) {
      request.log.info(
        { fromId: callbackQuery.from.id, chatId: callbackQuery.message?.chat.id ?? null },
        "Ignoring Telegram callback from disallowed chat"
      );
      return { ok: true, ignored: true, reason: "chat-not-allowed" };
    }

    if (!callbackQuery.message) {
      request.log.info({ callbackQueryId: callbackQuery.id }, "Ignoring Telegram callback without message payload");
      await answerTelegramCallbackQuery({
        botToken: config.TELEGRAM_BOT_TOKEN,
        callbackQueryId: callbackQuery.id,
        text: "No pude resolver ese botón.",
      });
      return { ok: true, ignored: true, reason: "callback-without-message" };
    }

    const callbackAction = parseOperatorCallbackData(callbackQuery.data);
    if (!callbackAction) {
      await answerTelegramCallbackQuery({
        botToken: config.TELEGRAM_BOT_TOKEN,
        callbackQueryId: callbackQuery.id,
        text: "Acción no reconocida.",
      });
      return { ok: true, ignored: true, reason: "unsupported-callback-action" };
    }

    const callbackMessage = callbackQuery.message;
    const externalRef = `telegram-user:${callbackQuery.from.id}`;
    const conversationKey = buildTelegramConversationKey(callbackMessage);
    const conversationTitle = buildTelegramConversationTitle(callbackMessage);
    const messageAt = new Date();

    const customerId = await upsertTelegramCustomer({
      externalRef,
      firstName: callbackQuery.from.first_name?.trim() || null,
      lastName: callbackQuery.from.last_name?.trim() || null,
    });

    const conversationId = await upsertTelegramConversation({
      customerId,
      conversationKey,
      conversationTitle,
      messageAt,
    });

    await saveConversationMessage({
      conversationId,
      direction: "system",
      senderKind: "admin",
      messageType: "event",
      textBody: `Telegram callback: ${callbackAction.action}`,
      payload: {
        source: "telegram-callback",
        callbackQueryId: callbackQuery.id,
        action: callbackAction.action,
        value: callbackAction.value,
        telegramMessageId: callbackMessage.message_id,
        chatId: callbackMessage.chat.id,
      },
    });

    void (async () => {
      try {
        await answerTelegramCallbackQuery({
          botToken: config.TELEGRAM_BOT_TOKEN,
          callbackQueryId: callbackQuery.id,
          text:
            callbackAction.action === "approve"
              ? "Ejecutando..."
              : callbackAction.action === "cancel"
                ? "Cancelando..."
                : callbackAction.action === "edit"
                  ? "Abrí corrección..."
                  : "Listo",
        });

        const actorRef = `telegram:${callbackMessage.chat.id}:${callbackQuery.from.id}`;

        if (callbackAction.action === "approve" || callbackAction.action === "cancel" || callbackAction.action === "pick") {
          try {
            await clearTelegramInlineKeyboard({
              botToken: config.TELEGRAM_BOT_TOKEN,
              chatId: callbackMessage.chat.id,
              messageId: callbackMessage.message_id,
            });
          } catch (error) {
            request.log.warn({ error }, "Failed to clear callback approval keyboard");
          }
        }

        if (callbackAction.action === "edit") {
          try {
            await clearTelegramInlineKeyboard({
              botToken: config.TELEGRAM_BOT_TOKEN,
              chatId: callbackMessage.chat.id,
              messageId: callbackMessage.message_id,
            });
          } catch (error) {
            request.log.warn({ error }, "Failed to clear callback edit keyboard");
          }

          const cancelResult = await handleTelegramOperatorMessage({
            actorRef,
            chatId: String(callbackMessage.chat.id),
            chatIdNumber: callbackMessage.chat.id,
            userId: String(callbackQuery.from.id),
            userMessage: `CANCEL ${callbackAction.value}`,
            conversationId,
          });
          const cancelText = cancelResult.kind === "reply" ? cancelResult.text.trim() : "Acción cancelada.";
          const promptText = `${cancelText}\n\nMandame la corrección y preparo una nueva acción.`;
          const telegramResponse = await sendTelegramMessage({
            botToken: config.TELEGRAM_BOT_TOKEN,
            chatId: callbackMessage.chat.id,
            text: promptText,
            replyToMessageId: callbackMessage.message_id,
            forceReply: true,
          });

          await saveConversationMessage({
            conversationId,
            direction: "outbound",
            senderKind: "tool",
            messageType: "text",
            textBody: promptText,
            payload: {
              source: "telegram-operator-edit",
              telegramMessageId: telegramResponse.message_id,
              telegramMessageIds: [telegramResponse.message_id],
              forceReply: true,
            },
          });
          return;
        }

        const syntheticText =
          callbackAction.action === "menu"
            ? `__menu:${callbackAction.value}__`
            : callbackAction.action === "pick"
              ? callbackAction.value.startsWith("purchase:")
                ? `__pick_purchase:${callbackAction.value.slice("purchase:".length)}__`
                : `__pick_product:${callbackAction.value}__`
            : `${callbackAction.action === "approve" ? "CONFIRM" : "CANCEL"} ${callbackAction.value}`;

        const operatorResult = await handleTelegramOperatorMessage({
          actorRef,
          chatId: String(callbackMessage.chat.id),
          chatIdNumber: callbackMessage.chat.id,
          userId: String(callbackQuery.from.id),
          userMessage: syntheticText,
          conversationId,
        });

        const outbound = await dispatchOperatorTelegramReply({
          chatId: callbackMessage.chat.id,
          replyToMessageId: callbackMessage.message_id,
          operatorResult,
        });

        await saveConversationMessage({
          conversationId,
          direction: "outbound",
          senderKind: "tool",
          messageType: "text",
          textBody: outbound.responseText,
          payload: {
            source: outbound.source,
            telegramMessageId: outbound.telegramMessageId,
            telegramMessageIds: outbound.telegramMessageIds,
            callbackAction: callbackAction.action,
            callbackValue: callbackAction.value,
          },
        });
      } catch (error) {
        request.log.error({ error }, "Telegram callback operator flow failed");
      }
    })();

    return {
      ok: true,
      accepted: true,
      callback: true,
    };
  }

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
      mediaGroupId: message.media_group_id ?? null,
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
        conversationId,
        imageBase64,
        attachedImageUrl,
      });

      const outbound = await dispatchOperatorTelegramReply({
        chatId: message.chat.id,
        replyToMessageId: message.message_id,
        operatorResult,
        imageBase64,
      });

      await saveConversationMessage({
        conversationId,
        direction: "outbound",
        senderKind: "tool",
        messageType: "text",
        textBody: outbound.responseText,
        payload: {
          source: outbound.source,
          telegramMessageId: outbound.telegramMessageId,
          telegramMessageIds: outbound.telegramMessageIds,
          buttons: operatorResult.kind === "reply" ? operatorResult.buttons ?? null : null,
          forceReply: operatorResult.kind === "reply" ? operatorResult.forceReply ?? false : false,
        },
      });

      request.log.info(
        {
          chatId: message.chat.id,
          inboundMessageId: inbound.id,
          outboundTelegramMessageId: outbound.telegramMessageId,
          streamed: operatorResult.kind === "chat",
        },
        "Telegram operator reply sent"
      );
    } catch (error) {
      request.log.error({ error }, "Telegram operator flow failed");

        const fallbackText = formatOperatorError(error);

      try {
        const telegramResponses = await sendTelegramTextMessages({
          botToken: config.TELEGRAM_BOT_TOKEN,
          chatId: message.chat.id,
          text: fallbackText,
          replyToMessageId: message.message_id,
        });
        const telegramMessageIds = telegramResponses.map((item) => item.message_id);
        const telegramMessageId = telegramMessageIds[0] ?? null;

        await saveConversationMessage({
          conversationId,
          direction: "outbound",
          senderKind: "tool",
          messageType: "text",
          textBody: fallbackText,
          payload: {
            source: "telegram-error",
            telegramMessageId,
            telegramMessageIds,
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
