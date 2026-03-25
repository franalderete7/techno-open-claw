import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const workflowPath = resolve(process.cwd(), "n8n/telegram/TechnoStore_Telegram_Operator_v1.json");

function node({ id, name, type, typeVersion, position, parameters, ...rest }) {
  return { id, name, type, typeVersion, position, parameters, ...rest };
}

const workflow = {
  name: "TechnoStore - Telegram Operator v1",
  active: false,
  nodes: [
    node({
      id: "telegram-webhook",
      name: "Telegram Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [-1160, 220],
      parameters: {
        httpMethod: "POST",
        path: "technostore-telegram-operator-v1",
        responseMode: "onReceived",
        options: {},
      },
      webhookId: "technostore-telegram-operator-v1",
    }),
    node({
      id: "parse-update",
      name: "Parse Telegram Update",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [-900, 220],
      parameters: {
        jsCode: `
const raw = $input.first().json || {};
const body = raw.body || raw;
const headers = raw.headers || {};
const message = body.message || body.edited_message || body.channel_post || body.edited_channel_post || null;

if (!message) {
  return [{ json: { ignore: true, ignore_reason: 'no_message_payload' } }];
}

const expectedSecret = String($env.TELEGRAM_WEBHOOK_SECRET || '').trim();
const providedSecret = String(headers['x-telegram-bot-api-secret-token'] || headers['X-Telegram-Bot-Api-Secret-Token'] || '').trim();
const secretValid = !expectedSecret || expectedSecret === providedSecret;

const allowedRaw = String($env.TELEGRAM_ALLOWED_CHAT_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const chatId = String(message.chat?.id || '');
const userId = String(message.from?.id || message.chat?.id || '');
const allowed =
  allowedRaw.length === 0 ||
  allowedRaw.includes(chatId) ||
  allowedRaw.includes(userId);

const photos = Array.isArray(message.photo) ? message.photo : [];
const photo = photos.length > 0 ? photos[photos.length - 1] : null;
const textBody = String(message.text || message.caption || '').trim();

let messageType = 'text';
if (message.voice || message.audio) messageType = 'audio';
else if (photo) messageType = 'image';
else if (message.video || message.video_note) messageType = 'video';
else if (message.document) messageType = 'file';

const firstName = String(message.from?.first_name || message.chat?.first_name || '').trim();
const lastName = String(message.from?.last_name || message.chat?.last_name || '').trim();
const conversationTitle =
  String(message.chat?.title || '').trim() ||
  [firstName, lastName].filter(Boolean).join(' ').trim() ||
  (message.chat?.username ? '@' + String(message.chat.username).trim() : '') ||
  (message.from?.username ? '@' + String(message.from.username).trim() : '') ||
  \`Telegram \${chatId}\`;

const mediaUrl =
  message.voice?.file_id ? \`telegram://voice/\${message.voice.file_id}\` :
  message.audio?.file_id ? \`telegram://audio/\${message.audio.file_id}\` :
  message.video?.file_id ? \`telegram://video/\${message.video.file_id}\` :
  message.video_note?.file_id ? \`telegram://video-note/\${message.video_note.file_id}\` :
  message.document?.file_id ? \`telegram://document/\${message.document.file_id}\` :
  photo?.file_id ? \`telegram://photo/\${photo.file_id}\` :
  null;

const userMessage =
  textBody ||
  (messageType === 'image' ? 'Please analyze the attached image.' :
   messageType === 'audio' ? '(audio message)' :
   '(empty message)');

return [{
  json: {
    ignore: !secretValid || !allowed,
    ignore_reason: !secretValid ? 'invalid_secret' : (!allowed ? 'chat_not_allowed' : null),
    secret_valid: secretValid,
    allowed,
    update_id: body.update_id ?? null,
    chat_id: chatId,
    chat_id_number: Number(message.chat?.id || 0),
    user_id: userId || null,
    message_id: message.message_id ?? null,
    first_name: firstName || null,
    last_name: lastName || null,
    external_ref: \`telegram-user:\${userId || chatId}\`,
    conversation_key: \`telegram-chat:\${chatId}\`,
    conversation_title: conversationTitle,
    text_body: textBody || null,
    user_message: userMessage,
    message_type: messageType,
    media_url: mediaUrl,
    voice_file_id: String(message.voice?.file_id || message.audio?.file_id || ''),
    photo_file_id: String(photo?.file_id || ''),
    message_at: new Date(((message.date ?? Math.floor(Date.now() / 1000))) * 1000).toISOString(),
    payload: {
      updateId: body.update_id ?? null,
      telegramMessageId: message.message_id ?? null,
      chatId: Number(message.chat?.id || 0),
      fromId: message.from?.id ?? null,
    },
  },
}];
        `.trim(),
      },
    }),
    node({
      id: "accept-update",
      name: "Accept Update?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [-660, 220],
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: "strict", version: 2 },
          conditions: [
            {
              id: "accept-update-condition",
              leftValue: "={{ $json.ignore }}",
              rightValue: false,
              operator: { type: "boolean", operation: "equals" },
            },
          ],
          combinator: "and",
        },
        options: {},
      },
    }),
    node({
      id: "ignored",
      name: "Ignored",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [-400, 420],
      parameters: {
        jsCode: `return [{ json: { ok: true, ignored: true, reason: $input.first().json.ignore_reason || 'ignored' } }];`,
      },
    }),
    node({
      id: "is-audio",
      name: "Is Audio?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [-400, 120],
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: "strict", version: 2 },
          conditions: [
            {
              id: "is-audio-condition",
              leftValue: "={{ $json.message_type }}",
              rightValue: "audio",
              operator: { type: "string", operation: "equals" },
            },
          ],
          combinator: "and",
        },
        options: {},
      },
    }),
    node({
      id: "get-audio-file",
      name: "Get Audio File Meta",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [-140, 20],
      continueOnFail: true,
      parameters: {
        url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/getFile?file_id=' + $json.voice_file_id }}",
        options: { timeout: 15000 },
      },
    }),
    node({
      id: "download-audio",
      name: "Download Audio",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [120, 20],
      continueOnFail: true,
      parameters: {
        url: "={{ 'https://api.telegram.org/file/bot' + $env.TELEGRAM_BOT_TOKEN + '/' + ($json.result?.file_path || '') }}",
        options: {
          response: { responseFormat: "file", outputPropertyName: "audioFile" },
          timeout: 15000,
        },
      },
    }),
    node({
      id: "groq-whisper",
      name: "Groq Whisper Transcribe",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [380, 20],
      continueOnFail: true,
      parameters: {
        method: "POST",
        url: "https://api.groq.com/openai/v1/audio/transcriptions",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Authorization", value: "=Bearer {{ $env.GROQ_API_KEY }}" },
          ],
        },
        sendBody: true,
        contentType: "multipart-form-data",
        bodyParameters: {
          parameters: [
            { parameterType: "formBinaryData", name: "file", inputDataFieldName: "audioFile" },
            { name: "model", value: "whisper-large-v3-turbo" },
            { name: "language", value: "es" },
            { name: "response_format", value: "json" },
          ],
        },
        options: { timeout: 15000 },
      },
    }),
    node({
      id: "is-image",
      name: "Is Image?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [640, 220],
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: "strict", version: 2 },
          conditions: [
            {
              id: "is-image-condition",
              leftValue: "={{ $('Parse Telegram Update').first().json.message_type }}",
              rightValue: "image",
              operator: { type: "string", operation: "equals" },
            },
          ],
          combinator: "and",
        },
        options: {},
      },
    }),
    node({
      id: "get-image-file",
      name: "Get Image File Meta",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [900, 120],
      continueOnFail: true,
      parameters: {
        url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/getFile?file_id=' + $('Parse Telegram Update').first().json.photo_file_id }}",
        options: { timeout: 15000 },
      },
    }),
    node({
      id: "download-image",
      name: "Download Image",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [1160, 120],
      continueOnFail: true,
      parameters: {
        url: "={{ 'https://api.telegram.org/file/bot' + $env.TELEGRAM_BOT_TOKEN + '/' + ($json.result?.file_path || '') }}",
        options: {
          response: { responseFormat: "file", outputPropertyName: "imageFile" },
          timeout: 15000,
        },
      },
    }),
    node({
      id: "encode-image",
      name: "Encode Image",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1420, 120],
      parameters: {
        jsCode: `
const binary = $input.first().binary?.imageFile;
if (!binary?.data) {
  return [{ json: { image_base64: null } }];
}
const mimeType = binary.mimeType || 'image/jpeg';
return [{ json: { image_base64: \`data:\${mimeType};base64,\${binary.data}\` } }];
        `.trim(),
      },
    }),
    node({
      id: "compose-input",
      name: "Compose Operator Input",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1680, 220],
      parameters: {
        jsCode: `
const base = $('Parse Telegram Update').first().json || {};
let transcript = null;
let imageBase64 = null;

try {
  const whisper = $('Groq Whisper Transcribe').first().json || {};
  if (typeof whisper.text === 'string' && whisper.text.trim()) {
    transcript = whisper.text.trim();
  }
} catch (error) {}

try {
  const image = $('Encode Image').first().json || {};
  if (typeof image.image_base64 === 'string' && image.image_base64.trim()) {
    imageBase64 = image.image_base64.trim();
  }
} catch (error) {}

const effectiveMessage =
  transcript ||
  base.user_message ||
  (imageBase64 ? 'Please analyze the attached image.' : 'Operator message');

return [{
  json: {
    actor_ref: \`telegram:\${base.chat_id}:\${base.user_id || base.chat_id}\`,
    chat_id: String(base.chat_id || ''),
    chat_id_number: Number(base.chat_id_number || 0),
    user_id: base.user_id || null,
    user_message: effectiveMessage,
    text_body: base.text_body || null,
    message_type: base.message_type || 'text',
    media_url: base.media_url || null,
    transcript,
    image_base64: imageBase64,
    external_ref: base.external_ref,
    conversation_key: base.conversation_key,
    conversation_title: base.conversation_title,
    first_name: base.first_name || null,
    last_name: base.last_name || null,
    message_at: base.message_at,
    reply_to_message_id: base.message_id || null,
    payload: {
      ...(base.payload || {}),
      source: 'n8n-telegram-operator-v1',
    },
  },
}];
        `.trim(),
      },
    }),
    node({
      id: "run-turn",
      name: "Run Operator Turn",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [1940, 220],
      parameters: {
        method: "POST",
        url: "={{ $env.OPENCLAW_API_BASE_URL + '/v1/operator/telegram/turn' }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Authorization", value: "=Bearer {{ $env.OPENCLAW_API_TOKEN }}" },
            { name: "Content-Type", value: "application/json" },
          ],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify($json) }}",
        options: { timeout: 20000 },
      },
    }),
    node({
      id: "needs-ai",
      name: "Needs AI Chat?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [2200, 220],
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: "strict", version: 2 },
          conditions: [
            {
              id: "needs-ai-condition",
              leftValue: "={{ $json.kind }}",
              rightValue: "chat",
              operator: { type: "string", operation: "equals" },
            },
          ],
          combinator: "and",
        },
        options: {},
      },
    }),
    node({
      id: "ollama-generate",
      name: "Ollama Generate",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [2460, 120],
      continueOnFail: true,
      parameters: {
        method: "POST",
        url: "={{ $env.OLLAMA_BASE_URL.replace(/\\/$/, '') + '/api/generate' }}",
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          "={{ JSON.stringify({ model: $env.OLLAMA_MODEL || 'qwen3.5:cloud', stream: false, system: $('Run Operator Turn').first().json.systemPrompt || '', prompt: $('Run Operator Turn').first().json.prompt || '', options: { temperature: 0.2, top_p: 0.9 } }) }}",
        options: { timeout: 45000 },
      },
    }),
    node({
      id: "finalize-reply",
      name: "Finalize Reply",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [2720, 220],
      parameters: {
        jsCode: `
const turn = $('Run Operator Turn').first().json || {};
const base = $('Compose Operator Input').first().json || {};

let replyText = String(turn.text || '').trim();

if (turn.kind === 'chat') {
  try {
    const llm = $('Ollama Generate').first().json || {};
    replyText = String(llm.response || '').trim();
  } catch (error) {
    replyText = '';
  }
}

if (!replyText) {
  replyText = 'No pude preparar una respuesta útil. Revisá la ejecución en n8n.';
}

return [{
  json: {
    chat_id: Number(base.chat_id_number || 0),
    reply_to_message_id: base.reply_to_message_id || null,
    text: replyText.slice(0, 4000),
    conversation_id: turn.conversation_id || null,
    payload: {
      telegramChatId: base.chat_id || null,
      inboundMessageId: turn.inbound_message_id || null,
      source: 'n8n-telegram-operator-v1',
    },
  },
}];
        `.trim(),
      },
    }),
    node({
      id: "send-message",
      name: "Send Telegram Message",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [2980, 220],
      parameters: {
        method: "POST",
        url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/sendMessage' }}",
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          "={{ JSON.stringify({ chat_id: $json.chat_id, text: $json.text, reply_to_message_id: $json.reply_to_message_id || undefined }) }}",
        options: { timeout: 15000 },
      },
    }),
    node({
      id: "build-outbound",
      name: "Build Outbound Save",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [3240, 220],
      parameters: {
        jsCode: `
const reply = $('Finalize Reply').first().json || {};
const sendResult = $input.first().json || {};

return [{
  json: {
    conversation_id: reply.conversation_id,
    text: reply.text,
    message_type: 'text',
    payload: {
      ...(reply.payload || {}),
      telegramMessageId: sendResult.result?.message_id || null,
    },
  },
}];
        `.trim(),
      },
    }),
    node({
      id: "persist-outbound",
      name: "Persist Outbound Message",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [3500, 220],
      continueOnFail: true,
      parameters: {
        method: "POST",
        url: "={{ $env.OPENCLAW_API_BASE_URL + '/v1/operator/telegram/messages' }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Authorization", value: "=Bearer {{ $env.OPENCLAW_API_TOKEN }}" },
            { name: "Content-Type", value: "application/json" },
          ],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify($json) }}",
        options: { timeout: 10000 },
      },
    }),
  ],
  connections: {
    "Telegram Webhook": { main: [[{ node: "Parse Telegram Update", type: "main", index: 0 }]] },
    "Parse Telegram Update": { main: [[{ node: "Accept Update?", type: "main", index: 0 }]] },
    "Accept Update?": {
      main: [
        [{ node: "Is Audio?", type: "main", index: 0 }],
        [{ node: "Ignored", type: "main", index: 0 }],
      ],
    },
    "Is Audio?": {
      main: [
        [{ node: "Get Audio File Meta", type: "main", index: 0 }],
        [{ node: "Is Image?", type: "main", index: 0 }],
      ],
    },
    "Get Audio File Meta": { main: [[{ node: "Download Audio", type: "main", index: 0 }]] },
    "Download Audio": { main: [[{ node: "Groq Whisper Transcribe", type: "main", index: 0 }]] },
    "Groq Whisper Transcribe": { main: [[{ node: "Is Image?", type: "main", index: 0 }]] },
    "Is Image?": {
      main: [
        [{ node: "Get Image File Meta", type: "main", index: 0 }],
        [{ node: "Compose Operator Input", type: "main", index: 0 }],
      ],
    },
    "Get Image File Meta": { main: [[{ node: "Download Image", type: "main", index: 0 }]] },
    "Download Image": { main: [[{ node: "Encode Image", type: "main", index: 0 }]] },
    "Encode Image": { main: [[{ node: "Compose Operator Input", type: "main", index: 0 }]] },
    "Compose Operator Input": { main: [[{ node: "Run Operator Turn", type: "main", index: 0 }]] },
    "Run Operator Turn": { main: [[{ node: "Needs AI Chat?", type: "main", index: 0 }]] },
    "Needs AI Chat?": {
      main: [
        [{ node: "Ollama Generate", type: "main", index: 0 }],
        [{ node: "Finalize Reply", type: "main", index: 0 }],
      ],
    },
    "Ollama Generate": { main: [[{ node: "Finalize Reply", type: "main", index: 0 }]] },
    "Finalize Reply": { main: [[{ node: "Send Telegram Message", type: "main", index: 0 }]] },
    "Send Telegram Message": { main: [[{ node: "Build Outbound Save", type: "main", index: 0 }]] },
    "Build Outbound Save": { main: [[{ node: "Persist Outbound Message", type: "main", index: 0 }]] },
  },
  settings: {
    executionOrder: "v1",
  },
  tags: [],
};

mkdirSync(dirname(workflowPath), { recursive: true });
writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Wrote ${workflowPath}`);
