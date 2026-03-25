/**
 * Telegram Streaming Response
 * 
 * Streams AI responses token-by-token like ChatGPT
 * Uses Ollama streaming API + Telegram editMessageText
 */

import { config } from "./config.js";
import { getOllamaBaseUrlCandidates } from "./ollama.js";

export interface StreamOptions {
  chatId: number;
  messageId: number;
  botToken: string;
  prompt: string;
  systemPrompt?: string;
  imageUrl?: string; // Optional: for vision models
}

export async function streamTelegramResponse(options: StreamOptions): Promise<string> {
  const { chatId, messageId, botToken, prompt, systemPrompt, imageUrl } = options;
  
  const model = config.OLLAMA_MODEL || "qwen3.5:cloud";
  const fullPrompt = systemPrompt 
    ? `${systemPrompt}\n\n${prompt}`
    : prompt;
  
  let accumulatedText = "";
  let lastSentText = "";
  let throttleCounter = 0;
  
  const requestBody: Record<string, unknown> = {
    model,
    stream: true,
    prompt: fullPrompt,
    options: {
      temperature: 0.7,
      top_p: 0.9,
    },
  };

  if (imageUrl) {
    requestBody.images = [imageUrl.split(",").pop()];
  }

  let lastError: unknown = null;

  for (const baseUrl of getOllamaBaseUrlCandidates()) {
    try {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        lastError = new Error(`Ollama API error via ${baseUrl}: ${response.status}`);
        continue;
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
            } catch {
              // Ignore malformed chunk lines and keep streaming.
            }
          }
        }
      }

      if (accumulatedText !== lastSentText) {
        await updateTelegramMessage(chatId, messageId, botToken, accumulatedText);
      }

      return accumulatedText;
    } catch (error) {
      lastError = error;
    }
  }

  console.error("Streaming failed:", lastError);
  await updateTelegramMessage(chatId, messageId, botToken, "OpenClaw could not generate a streamed reply.");
  return "";
}

async function updateTelegramMessage(
  chatId: number,
  messageId: number,
  botToken: string,
  text: string
) {
  try {
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
          text: "OpenClaw is thinking...",
          reply_to_message_id: replyToMessageId,
          allow_sending_without_reply: true,
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
