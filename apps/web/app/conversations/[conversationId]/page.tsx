import Link from "next/link";
import { getConversationMessages, getConversations } from "../../../lib/api";

type ConversationPageProps = {
  params: Promise<{
    conversationId: string;
  }>;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" });
}

function summarizePayload(payload: Record<string, unknown>) {
  const keys = Object.keys(payload || {});
  if (keys.length === 0) {
    return null;
  }

  return keys
    .slice(0, 6)
    .map((key) => `${key}: ${typeof payload[key] === "object" ? JSON.stringify(payload[key]) : String(payload[key])}`)
    .join(" · ");
}

function isPreviewableImage(url: string | null) {
  if (!url) {
    return false;
  }

  return (/^https?:\/\//.test(url) && /(\.png|\.jpe?g|\.webp|\.gif)(\?|$)/i.test(url)) || url.includes("/media/");
}

export default async function ConversationDetailPage({ params }: ConversationPageProps) {
  const { conversationId: rawConversationId } = await params;
  const conversationId = Number(rawConversationId);

  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    throw new Error("Invalid conversation id");
  }

  let conversation = null as Awaited<ReturnType<typeof getConversations>>["items"][number] | null;
  let messages = [] as Awaited<ReturnType<typeof getConversationMessages>>["items"];
  let error: string | null = null;

  try {
    const [conversationResponse, messageResponse] = await Promise.all([
      getConversations(200),
      getConversationMessages(conversationId),
    ]);

    conversation = conversationResponse.items.find((item) => item.id === conversationId) ?? null;
    messages = messageResponse.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load conversation";
  }

  const title = conversation
    ? [conversation.first_name, conversation.last_name].filter(Boolean).join(" ") || "Unknown contact"
    : `Conversation #${conversationId}`;

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Conversations</span>
        <h2 className="hero-title">{title}</h2>
        <div className="chip-row">
          <span className="chip accent">#{conversationId}</span>
          {conversation ? <span className="chip">{conversation.channel}</span> : null}
          {conversation ? <span className={`chip ${conversation.status === "open" ? "good" : "warn"}`}>{conversation.status}</span> : null}
          <span className="chip">{messages.length} messages</span>
        </div>
        <div className="meta-row">
          <Link href="/conversations" className="chip action-link">
            Back to threads
          </Link>
        </div>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {conversation ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">Thread Summary</h3>
              <p className="panel-copy mono">{conversation.channel_thread_key}</p>
            </div>
          </div>

          <dl className="record-meta-grid">
            <div>
              <dt>Phone</dt>
              <dd>{conversation.phone || "-"}</dd>
            </div>
            <div>
              <dt>Customer ID</dt>
              <dd>{conversation.customer_id ?? "-"}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(conversation.created_at)}</dd>
            </div>
            <div>
              <dt>Last activity</dt>
              <dd>{conversation.last_message_at ? formatDate(conversation.last_message_at) : "No activity yet"}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Interaction Timeline</h3>
            <p className="panel-copy">Inbound operator messages and outbound bot replies are stored in `public.messages`.</p>
          </div>
        </div>

        {messages.length === 0 ? (
          <p className="empty">No interaction messages were found for this conversation.</p>
        ) : (
          <div className="message-timeline">
            {messages.map((message) => {
              const payloadSummary = summarizePayload(message.payload);
              const bubbleClass =
                message.direction === "outbound"
                  ? "message-bubble outbound"
                  : message.direction === "system"
                    ? "message-bubble system"
                    : "message-bubble inbound";

              return (
                <article key={message.id} className={bubbleClass}>
                  <div className="message-meta">
                    <div className="chip-row">
                      <span className="chip accent mono">#{message.id}</span>
                      <span className="chip">{message.direction}</span>
                      <span className="chip">{message.sender_kind}</span>
                      <span className="chip">{message.message_type}</span>
                    </div>
                    <span className="muted">{formatDate(message.created_at)}</span>
                  </div>

                  {message.text_body ? <p className="message-body">{message.text_body}</p> : null}
                  {message.transcript ? <p className="message-support"><strong>Transcript:</strong> {message.transcript}</p> : null}
                  {message.media_url ? (
                    <div className="message-asset">
                      {isPreviewableImage(message.media_url) ? (
                        <img className="message-image" src={message.media_url} alt={`Message ${message.id} asset`} loading="lazy" />
                      ) : null}
                      <a className="message-link mono" href={message.media_url} target="_blank" rel="noreferrer">
                        {message.media_url}
                      </a>
                    </div>
                  ) : null}
                  {payloadSummary ? <p className="message-support mono">{payloadSummary}</p> : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
