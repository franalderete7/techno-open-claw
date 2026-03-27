"use client";

import { useDeferredValue, useState } from "react";
import type { AuditRecord } from "../../lib/api";
import { SearchToolbar } from "./search-toolbar";

type AuditExplorerProps = {
  items: AuditRecord[];
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function stringifyMetadata(value: unknown) {
  return value == null ? "" : JSON.stringify(value);
}

function summarizeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value == null ? "No metadata" : "Metadata";
  }

  const keys = Object.keys(value).slice(0, 3);
  return keys.length > 0 ? keys.join(" • ") : "Metadata";
}

export function AuditExplorer({ items }: AuditExplorerProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  const filteredItems = items.filter((item) => {
    const matchesQuery =
      needle.length === 0 ||
      [item.actor_type, item.actor_id ?? "", item.action, item.entity_type, item.entity_id, stringifyMetadata(item.metadata)]
        .join(" ")
        .toLowerCase()
        .includes(needle);

    const matchesFilter = filter === "all" || item.actor_type === filter;

    return matchesQuery && matchesFilter;
  });

  const actorTypes = Array.from(new Set(items.map((item) => item.actor_type)));

  return (
    <div className="page-stack">
      <SearchToolbar
        label="Search audit trail"
        placeholder="Search by actor, action, entity, id, or metadata"
        query={query}
        onQueryChange={setQuery}
        totalCount={items.length}
        resultCount={filteredItems.length}
        filters={[
          { value: "all", label: "All", count: items.length },
          ...actorTypes.map((actorType) => ({
            value: actorType,
            label: actorType,
            count: items.filter((item) => item.actor_type === actorType).length,
          })),
        ]}
        activeFilter={filter}
        onFilterChange={setFilter}
      />

      {filteredItems.length === 0 ? (
        <section className="panel">
          <p className="empty">No audit entries match this search.</p>
        </section>
      ) : (
        <section className="record-grid reveal-grid">
          {filteredItems.map((item) => (
            <article key={item.id} className="record-card">
              <div className="record-header">
                <div>
                  <p className="catalog-kicker">{formatDate(item.created_at)}</p>
                  <h3 className="record-title mono">{item.action}</h3>
                  <p className="record-subtitle">
                    {item.entity_type} #{item.entity_id}
                  </p>
                </div>
                <span className="chip">{item.actor_type}</span>
              </div>

              <dl className="record-meta-grid">
                <div>
                  <dt>Actor ID</dt>
                  <dd className="mono">{item.actor_id || "-"}</dd>
                </div>
                <div>
                  <dt>Entity</dt>
                  <dd className="mono">
                    {item.entity_type}:{item.entity_id}
                  </dd>
                </div>
              </dl>

              {item.metadata != null ? (
                <details className="field-details record-fold">
                  <summary className="field-summary fold-summary">
                    <span>Metadata</span>
                    <span className="fold-meta">{summarizeMetadata(item.metadata)}</span>
                  </summary>
                  <pre className="json-block">{JSON.stringify(item.metadata, null, 2)}</pre>
                </details>
              ) : null}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
