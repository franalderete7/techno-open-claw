/**
 * Telegram Streaming Response
 * 
 * Streams AI responses token-by-token like ChatGPT
 * Uses Ollama streaming API + Telegram editMessageText
 */

import { config } from "./config.js";
import { pool } from "./db.js";

export interface StreamOptions {
  chatId: number;
  messageId: number;
  botToken: string;
  prompt: string;
  systemPrompt?: string;
  imageUrl?: string; // Optional: for vision models
}

/**
 * Escape markdown for Telegram (avoid parse errors)
 * Use "Markdown" parse_mode but escape special chars in code blocks
 */
function escapeTelegramMarkdown(text: string): string {
  // Simple escape: replace unescaped backticks with escaped ones
  // This prevents "unclosed entity" errors
  return text
    .replace(/```/g, '\\`\\`\\`')
    .replace(/(?<!`)`(?!`)/g, '\\`')
    .slice(0, 4000); // Telegram limit
}

export async function streamTelegramResponse(options: StreamOptions): Promise<string> {
  const { chatId, messageId, botToken, prompt, systemPrompt, imageUrl } = options;
  
  const model = config.OLLAMA_MODEL || "qwen3.5:cloud";
  const baseUrl = config.OLLAMA_BASE_URL || "http://172.17.0.1:11434";
  
  const fullPrompt = systemPrompt 
    ? `${systemPrompt}\n\n${prompt}`
    : prompt;
  
  let accumulatedText = "";
  let lastSentText = "";
  let throttleCounter = 0;
  
  try {
    // Check if we have an image (vision model)
    const requestBody: any = {
      model: model,
      stream: true,
      options: {
        temperature: 0.7,
        top_p: 0.9,
      },
    };
    
    if (imageUrl) {
      // Use vision model with image
      requestBody.prompt = fullPrompt;
      requestBody.images = [imageUrl.split(',').pop()]; // Extract base64 from data URL
    } else {
      // Standard text-only
      requestBody.prompt = fullPrompt;
    }
    
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }
    
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }
    
    const decoder = new TextDecoder();
    let done = false;
    
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      
      if (value) {
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.trim());
        
        for (const line of lines) {
          if (line.includes("error")) continue;
          
          try {
            const json = JSON.parse(line);
            const responseText = json.response as string;
            
            if (responseText) {
              accumulatedText += responseText;
              throttleCounter++;
              
              // Send update every 3 tokens to avoid rate limiting
              if (throttleCounter >= 3) {
                await updateTelegramMessage(chatId, messageId, botToken, accumulatedText);
                lastSentText = accumulatedText;
                throttleCounter = 0;
              }
            }
            
            if (json.done === true) {
              done = true;
              break;
            }
          } catch (e) {
            // Skip malformed JSON lines
          }
        }
      }
    }
    
    // Final update if there's remaining text
    if (accumulatedText !== lastSentText) {
      // Escape markdown for final send
      const escapedText = escapeTelegramMarkdown(accumulatedText);
      await updateTelegramMessage(chatId, messageId, botToken, escapedText);
    }
    
    return accumulatedText;
  } catch (error) {
    console.error("Streaming failed:", error);
    
    // Fallback: send error message
    await updateTelegramMessage(
      chatId,
      messageId,
      botToken,
      "⚠️ Error generating response. Please try again."
    );
    
    return "";
  }
}

async function updateTelegramMessage(
  chatId: number,
  messageId: number,
  botToken: string,
  text: string
) {
  try {
    // Truncate if too long (Telegram limit: 4096)
    const safeText = text.slice(0, 4000);
    
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/editMessageText`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: safeText,
          parse_mode: "Markdown",
        }),
      }
    );
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error("Telegram edit failed:", errorData);
    }
  } catch (error) {
    console.error("Telegram update failed:", error);
  }
}

/**
 * Send initial "thinking..." message
 */
export async function sendThinkingMessage(
  chatId: number,
  botToken: string,
  replyToMessageId?: number
): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "🤔 Thinking...",
          reply_to_message_id: replyToMessageId,
        }),
      }
    );
    
    const data = await response.json();
    if (data.ok && data.result?.message_id) {
      return data.result.message_id;
    }
    
    return null;
  } catch (error) {
    console.error("Failed to send thinking message:", error);
    return null;
  }
}
