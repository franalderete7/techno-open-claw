/**
 * ManyChat Integration
 * 
 * Customer-facing WhatsApp sales bot through ManyChat API
 * This is where the actual customer conversations happen
 */

import { z } from "zod";
import { config } from "./config.js";

const manyChatUserSchema = z.object({
  id: z.string(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

const manyChatMessageSchema = z.object({
  id: z.string(),
  type: z.string(),
  text: z.string().optional(),
  created_at: z.string(),
  from: z.object({
    id: z.string(),
    type: z.string(),
  }),
});

export interface ManyChatUser {
  id: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  custom_fields?: Record<string, unknown>;
}

export interface ManyChatMessage {
  id: string;
  type: string;
  text?: string;
  created_at: string;
  from: {
    id: string;
    type: string;
  };
}

export interface ManyChatConversation {
  user: ManyChatUser;
  messages: ManyChatMessage[];
  custom_fields: Record<string, string>;
}

/**
 * Fetch ManyChat user by ID
 */
export async function fetchManyChatUser(userId: string): Promise<ManyChatUser | null> {
  const apiKey = config.MANYCHAT_API_KEY;
  const accountId = config.MANYCHAT_ACCOUNT_ID;
  
  if (!apiKey || !accountId) {
    console.warn("ManyChat not configured");
    return null;
  }
  
  try {
    const response = await fetch(
      `https://graph.manychat.com/1.0/account/${accountId}/subscriber/${userId}`,
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );
    
    if (!response.ok) {
      console.error(`ManyChat API error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    return manyChatUserSchema.parse(data);
  } catch (error) {
    console.error("Failed to fetch ManyChat user:", error);
    return null;
  }
}

/**
 * Send message through ManyChat
 */
export async function sendManyChatMessage(
  userId: string,
  text: string,
  options?: {
    conversation_type?: "SESSION" | "MARKETING";
    attachment?: Record<string, unknown>;
  }
): Promise<boolean> {
  const apiKey = config.MANYCHAT_API_KEY;
  const accountId = config.MANYCHAT_ACCOUNT_ID;
  
  if (!apiKey || !accountId) {
    console.warn("ManyChat not configured");
    return false;
  }
  
  try {
    const payload: Record<string, unknown> = {
      subscriber_id: userId,
      content: {
        type: "text",
        text: text,
      },
      conversation_type: options?.conversation_type || "SESSION",
    };
    
    const response = await fetch(
      `https://graph.manychat.com/1.0/account/${accountId}/content/send`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ManyChat send error: ${response.status} - ${errorText}`);
      return false;
    }
    
    const data = await response.json();
    return !!data.id;
  } catch (error) {
    console.error("Failed to send ManyChat message:", error);
    return false;
  }
}

/**
 * Update ManyChat custom fields (for CRM/tagging)
 */
export async function updateManyChatFields(
  userId: string,
  fields: Record<string, string>
): Promise<boolean> {
  const apiKey = config.MANYCHAT_API_KEY;
  const accountId = config.MANYCHAT_ACCOUNT_ID;
  
  if (!apiKey || !accountId) {
    return false;
  }
  
  try {
    const response = await fetch(
      `https://graph.manychat.com/1.0/account/${accountId}/subscriber/${userId}/fields`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: Object.entries(fields).map(([key, value]) => ({
            key,
            value,
          })),
        }),
      }
    );
    
    return response.ok;
  } catch (error) {
    console.error("Failed to update ManyChat fields:", error);
    return false;
  }
}

/**
 * Sync customer state to ManyChat custom fields
 */
export async function syncCustomerToManyChat(
  manyChatUserId: string,
  customerState: {
    lead_score?: number;
    funnel_stage?: string;
    last_intent?: string;
    tags?: string[];
    interested_product?: string;
    city?: string;
  }
): Promise<void> {
  const fields: Record<string, string> = {};
  
  if (customerState.lead_score !== undefined) {
    fields["lead_score"] = String(customerState.lead_score);
  }
  
  if (customerState.funnel_stage) {
    fields["funnel_stage"] = customerState.funnel_stage;
  }
  
  if (customerState.last_intent) {
    fields["last_intent"] = customerState.last_intent;
  }
  
  if (customerState.tags && customerState.tags.length > 0) {
    fields["tags"] = customerState.tags.join(",");
  }
  
  if (customerState.interested_product) {
    fields["interested_product"] = customerState.interested_product;
  }
  
  if (customerState.city) {
    fields["city"] = customerState.city;
  }
  
  await updateManyChatFields(manyChatUserId, fields);
}

/**
 * Process ManyChat webhook (incoming message from WhatsApp)
 */
export async function handleManyChatWebhook(payload: unknown): Promise<{
  ok: boolean;
  userId?: string;
  messageText?: string;
  conversationId?: string;
}> {
  try {
    // ManyChat webhook payload structure
    const schema = z.object({
      subscriber_id: z.string(),
      message: z.object({
        id: z.string(),
        type: z.string(),
        text: z.string().optional(),
        created_at: z.string(),
      }),
      conversation_type: z.string().optional(),
    });
    
    const data = schema.parse(payload);
    
    // Process through sales agent (reuse the same logic)
    // This would call the same processTurn() but with ManyChat context
    
    return {
      ok: true,
      userId: data.subscriber_id,
      messageText: data.message.text || "",
      conversationId: data.message.id,
    };
  } catch (error) {
    console.error("ManyChat webhook parse failed:", error);
    return { ok: false };
  }
}
