import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { handleTelegramOperatorMessage } from "../telegram-operator.js";
import { saveConversationMessage, upsertTelegramConversation, upsertTelegramCustomer } from "../telegram-storage.js";

const inboundTurnSchema = z.object({
  actor_ref: z.string().trim().min(1),
  chat_id: z.string().trim().min(1),
  chat_id_number: z.coerce.number().int(),
  user_id: z.string().trim().optional().nullable(),
  user_message: z.string().trim().min(1),
  text_body: z.string().trim().optional().nullable(),
  message_type: z.enum(["text", "audio", "image", "video", "file"]).default("text"),
  media_url: z.string().trim().optional().nullable(),
  transcript: z.string().trim().optional().nullable(),
  image_base64: z.string().trim().optional().nullable(),
  external_ref: z.string().trim().min(1),
  conversation_key: z.string().trim().min(1),
  conversation_title: z.string().trim().min(1),
  first_name: z.string().trim().optional().nullable(),
  last_name: z.string().trim().optional().nullable(),
  message_at: z.string().datetime().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const outboundMessageSchema = z.object({
  conversation_id: z.coerce.number().int().positive(),
  text: z.string().trim().min(1),
  message_type: z.enum(["text", "audio", "image", "video", "file"]).default("text"),
  media_url: z.string().trim().optional().nullable(),
  transcript: z.string().trim().optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const telegramOperatorApiRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/operator/telegram/turn", async (request) => {
    const body = inboundTurnSchema.parse(request.body);
    const messageAt = body.message_at ? new Date(body.message_at) : new Date();

    const customerId = await upsertTelegramCustomer({
      externalRef: body.external_ref,
      firstName: body.first_name ?? null,
      lastName: body.last_name ?? null,
    });

    const conversationId = await upsertTelegramConversation({
      customerId,
      conversationKey: body.conversation_key,
      conversationTitle: body.conversation_title,
      messageAt,
    });

    const inboundMessageId = await saveConversationMessage({
      conversationId,
      direction: "inbound",
      senderKind: "customer",
      messageType: body.message_type,
      textBody: body.text_body ?? body.user_message,
      mediaUrl: body.media_url ?? null,
      transcript: body.transcript ?? null,
      payload: body.payload ?? {},
    });

    const result = await handleTelegramOperatorMessage({
      actorRef: body.actor_ref,
      chatId: body.chat_id,
      chatIdNumber: body.chat_id_number,
      userId: body.user_id ?? null,
      userMessage: body.user_message,
      imageBase64: body.image_base64 ?? undefined,
    });

    return {
      ...result,
      customer_id: customerId,
      conversation_id: conversationId,
      inbound_message_id: inboundMessageId,
    };
  });

  app.post("/v1/operator/telegram/messages", async (request) => {
    const body = outboundMessageSchema.parse(request.body);
    const messageId = await saveConversationMessage({
      conversationId: body.conversation_id,
      direction: "outbound",
      senderKind: "tool",
      messageType: body.message_type,
      textBody: body.text,
      mediaUrl: body.media_url ?? null,
      transcript: body.transcript ?? null,
      payload: body.payload ?? {},
    });

    return {
      id: messageId,
      conversation_id: body.conversation_id,
    };
  });
};
