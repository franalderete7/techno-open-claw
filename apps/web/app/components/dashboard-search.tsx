"use client";

import { useDeferredValue, useState } from "react";
import type { ConversationRecord, CustomerRecord, ProductRecord, SettingRecord } from "../../lib/api";
import { SearchToolbar } from "./search-toolbar";

type DashboardSearchProps = {
  products: ProductRecord[];
  customers: CustomerRecord[];
  conversations: ConversationRecord[];
  settings: SettingRecord[];
};

type SearchHit = {
  id: string;
  type: "product" | "customer" | "conversation" | "setting";
  title: string;
  subtitle: string;
  meta: string;
};

function formatSettingValue(value: unknown) {
  if (value == null) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function DashboardSearch({ products, customers, conversations, settings }: DashboardSearchProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  const hits: SearchHit[] = needle
    ? [
        ...products
          .filter((item) =>
            [item.brand, item.model, item.title, item.sku, item.description ?? ""].join(" ").toLowerCase().includes(needle)
          )
          .slice(0, 5)
          .map((item) => ({
            id: `product-${item.id}`,
            type: "product" as const,
            title: item.title,
            subtitle: `${item.brand} ${item.model}`.trim(),
            meta: item.sku,
          })),
        ...customers
          .filter((item) =>
            [item.first_name ?? "", item.last_name ?? "", item.phone ?? "", item.email ?? "", item.external_ref ?? ""]
              .join(" ")
              .toLowerCase()
              .includes(needle)
          )
          .slice(0, 5)
          .map((item) => ({
            id: `customer-${item.id}`,
            type: "customer" as const,
            title: [item.first_name, item.last_name].filter(Boolean).join(" ") || "Unnamed contact",
            subtitle: item.phone || item.email || "No phone or email",
            meta: item.external_ref || `#${item.id}`,
          })),
        ...conversations
          .filter((item) =>
            [
              item.channel,
              item.channel_thread_key,
              item.first_name ?? "",
              item.last_name ?? "",
              item.phone ?? "",
            ]
              .join(" ")
              .toLowerCase()
              .includes(needle)
          )
          .slice(0, 5)
          .map((item) => ({
            id: `conversation-${item.id}`,
            type: "conversation" as const,
            title: [item.first_name, item.last_name].filter(Boolean).join(" ") || "Unknown thread",
            subtitle: item.phone || item.channel,
            meta: item.channel_thread_key,
          })),
        ...settings
          .filter((item) =>
            [item.key, item.description ?? "", formatSettingValue(item.value)].join(" ").toLowerCase().includes(needle)
          )
          .slice(0, 5)
          .map((item) => ({
            id: `setting-${item.key}`,
            type: "setting" as const,
            title: item.key.replace(/[_-]+/g, " "),
            subtitle: item.description || formatSettingValue(item.value).slice(0, 80),
            meta: item.key,
          })),
      ].slice(0, 10)
    : [];

  return (
    <section className="panel quick-search-panel">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">Quick Find</h3>
          <p className="panel-copy">Search products, customers, settings, and active threads from one place.</p>
        </div>
      </div>

      <SearchToolbar
        label="Search across the workspace"
        placeholder="Try a SKU, phone, customer name, or setting key"
        query={query}
        onQueryChange={setQuery}
        totalCount={products.length + customers.length + conversations.length + settings.length}
        resultCount={hits.length}
      />

      {needle.length === 0 ? (
        <p className="empty">Start typing to surface live matches from your current workspace.</p>
      ) : hits.length === 0 ? (
        <p className="empty">No results matched that search.</p>
      ) : (
        <div className="quick-search-results">
          {hits.map((hit) => (
            <article key={hit.id} className="quick-search-result">
              <div className="chip-row">
                <span className="chip accent">{hit.type}</span>
                <span className="chip mono">{hit.meta}</span>
              </div>
              <strong>{hit.title}</strong>
              <span className="muted">{hit.subtitle}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
