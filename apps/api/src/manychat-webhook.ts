/**
 * ManyChat Webhook Handler
 * 
 * Customer-facing WhatsApp sales bot
 * Replaces n8n workflow for customer conversations
 * 
 * Webhook URL: https://your-domain.com/webhooks/manychat
 */

import { FastifyRequest, FastifyReply } from "fastify";
import { config } from "./config.js";
import { processTurn, saveInboundMessage } from "./sales-agent.js";
import { sendManyChatMessage, syncCustomerToManyChat } from "./manychat.js";

export async function handleManyChatWebhook(request: FastifyRequest, reply: FastifyReply) {
  try {
    const body = request.body as any;
    
    // ManyChat webhook payload
    const subscriberId = body.subscriber_id as string;
    const messageText = body.message?.text || body.userInput || "";
    const firstName = body.first_name || body.contactName || "Cliente";
    const phone = body.phone || "";
    const isAudio = body.was_audio || false;
    
    if (!subscriberId) {
      return reply.code(400).send({ error: "Missing subscriber_id" });
    }
    
    // Process through sales agent (same logic as Telegram but for ManyChat)
    const turnResult = await processTurn({
      channel: "manychat",
      channel_thread_key: `mc-${subscriberId}`,
      user_message: messageText,
      raw_message: messageText,
      is_audio: isAudio,
      subscriber_id: subscriberId,
      phone: phone,
      message_date: new Date().toISOString(),
    });
    
    // Save inbound message to database
    if (turnResult.conversation_id) {
      await saveInboundMessage({
        conversation_id: turnResult.conversation_id,
        direction: "inbound",
        sender_kind: "customer",
        message_type: isAudio ? "audio" : "text",
        text_body: messageText,
        media_url: null,
        transcript: isAudio ? messageText : null,
        payload: body as Record<string, unknown>,
      });
    }
    
    // Send reply via ManyChat if needed
    if (turnResult.should_reply && turnResult.reply_text) {
      await sendManyChatMessage(subscriberId, turnResult.reply_text);
    }
    
    // Sync customer state to ManyChat custom fields
    if (turnResult.customer_id && turnResult.validator_output) {
      await syncCustomerToManyChat(subscriberId, {
        lead_score: turnResult.validator_output.final_state_delta.lead_score_delta,
        funnel_stage: turnResult.validator_output.final_state_delta.funnel_stage,
        last_intent: turnResult.validator_output.final_state_delta.intent_key,
        tags: turnResult.validator_output.final_state_delta.tags_to_add,
        interested_product: turnResult.validator_output.selected_product_keys[0],
      });
    }
    
    return reply.send({
      ok: true,
      conversationId: turnResult.conversation_id,
      customerId: turnResult.customer_id,
      replied: turnResult.should_reply,
      stateApplied: turnResult.state_applied,
    });
    
  } catch (error) {
    console.error("ManyChat webhook error:", error);
    return reply.code(500).send({ error: "Webhook processing failed" });
  }
}
