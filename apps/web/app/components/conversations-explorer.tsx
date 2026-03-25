"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import type { ConversationRecord } from "../../lib/api";
import { SearchToolbar } from "./search-toolbar";

type ConversationsExplorerProps = {
  items: ConversationRecord[];
};

function formatDate(value: string | null) {
  if (!value) return "No activity yet";
  return new Date(value).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" });
}

export function ConversationsExplorer({ items }: ConversationsExplorerProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  const filteredItems = items.filter((conversation) => {
    const matchesQuery =
      needle.length === 0 ||
      [
        conversation.channel,
        conversation.channel_thread_key,
        conversation.first_name ?? "",
        conversation.last_name ?? "",
        conversation.phone ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);

    const matchesFilter = filter === "all" || conversation.status === filter;
    return matchesQuery && matchesFilter;
  });

  return (
    <div className="page-stack">
      <SearchToolbar
        label="Search conversations"
        placeholder="Search by customer, phone, channel, or thread key"
        query={query}
        onQueryChange={setQuery}
        totalCount={items.length}
        resultCount={filteredItems.length}
        filters={[
          { value: "all", label: "All", count: items.length },
          { value: "open", label: "Open", count: items.filter((item) => item.status === "open").length },
          { value: "closed", label: "Closed", count: items.filter((item) => item.status === "closed").length },
        ]}
        activeFilter={filter}
        onFilterChange={setFilter}
      />

      {filteredItems.length === 0 ? (
        <section className="panel">
          <p className="empty">No conversations match this search.</p>
        </section>
      ) : (
        <section className="record-grid reveal-grid">
          {filteredItems.map((conversation) => (
            <article key={conversation.id} className="record-card">
              <div className="record-header">
                <div>
                  <p className="catalog-kicker">{conversation.channel}</p>
                  <h3 className="record-title">
                    {[conversation.first_name, conversation.last_name].filter(Boolean).join(" ") || "Unknown contact"}
                  </h3>
                  <p className="record-subtitle mono">{conversation.channel_thread_key}</p>
                </div>
                <span className={`pill ${conversation.status === "open" ? "good" : "warn"}`}>{conversation.status}</span>
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
                  <dt>Last activity</dt>
                  <dd>{formatDate(conversation.last_message_at)}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(conversation.created_at)}</dd>
                </div>
              </dl>

              <div className="record-actions">
                <Link href={`/conversations/${conversation.id}`} className="chip accent action-link">
                  Open thread
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
