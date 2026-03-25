import { getConversations } from "../../lib/api";
import { ConversationsExplorer } from "../components/conversations-explorer";

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

      <ConversationsExplorer items={items} />
    </div>
  );
}
