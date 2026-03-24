import { getConversations } from "../../lib/api";

function formatDate(value: string | null) {
  if (!value) return "No messages yet";
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function ConversationsPage() {
  let items = [] as Awaited<ReturnType<typeof getConversations>>["items"];
  let error: string | null = null;

  try {
    const response = await getConversations(80);
    items = response.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load conversations";
  }

  const openCount = items.filter((item) => item.status === "open").length;

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Conversations</span>
        <h2 className="hero-title">Threads</h2>
        <div className="chip-row">
          <span className="chip accent">{items.length} threads</span>
          <span className="chip good">{openCount} open</span>
        </div>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {items.length === 0 ? (
        <section className="panel">
          <p className="empty">No conversations available.</p>
        </section>
      ) : (
        <section className="catalog-grid">
          {items.map((conversation) => (
            <article key={conversation.id} className="catalog-card">
              <div className="catalog-card-head">
                <div>
                  <p className="catalog-kicker">{conversation.channel}</p>
                  <h3 className="catalog-title">
                    {[conversation.first_name, conversation.last_name].filter(Boolean).join(" ") || "Unknown contact"}
                  </h3>
                  <p className="catalog-subtitle mono">{conversation.channel_thread_key}</p>
                </div>
                <div className="chip-row">
                  <span className={`chip ${conversation.status === "open" ? "good" : "warn"}`}>
                    {conversation.status}
                  </span>
                </div>
              </div>

              <dl className="catalog-meta">
                <div>
                  <dt>Customer ID</dt>
                  <dd>{conversation.customer_id ?? "-"}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{conversation.phone || "-"}</dd>
                </div>
                <div>
                  <dt>Last Activity</dt>
                  <dd>{formatDate(conversation.last_message_at)}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(conversation.created_at)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
