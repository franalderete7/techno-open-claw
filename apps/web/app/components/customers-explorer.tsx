"use client";

import { useDeferredValue, useState } from "react";
import type { CustomerRecord } from "../../lib/api";
import { SearchToolbar } from "./search-toolbar";

type CustomersExplorerProps = {
  items: CustomerRecord[];
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("es-AR", { dateStyle: "medium" });
}

export function CustomersExplorer({ items }: CustomersExplorerProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  const filteredItems = items.filter((customer) => {
    const matchesQuery =
      needle.length === 0 ||
      [
        customer.first_name ?? "",
        customer.last_name ?? "",
        customer.phone ?? "",
        customer.email ?? "",
        customer.external_ref ?? "",
        customer.notes ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);

    const matchesFilter =
      filter === "all" ||
      (filter === "phone" && Boolean(customer.phone)) ||
      (filter === "email" && Boolean(customer.email)) ||
      (filter === "notes" && Boolean(customer.notes));

    return matchesQuery && matchesFilter;
  });

  return (
    <div className="page-stack">
      <SearchToolbar
        label="Search customers"
        placeholder="Search by name, phone, email, ManyChat ref, or notes"
        query={query}
        onQueryChange={setQuery}
        totalCount={items.length}
        resultCount={filteredItems.length}
        filters={[
          { value: "all", label: "All", count: items.length },
          { value: "phone", label: "With phone", count: items.filter((item) => Boolean(item.phone)).length },
          { value: "email", label: "With email", count: items.filter((item) => Boolean(item.email)).length },
          { value: "notes", label: "With notes", count: items.filter((item) => Boolean(item.notes)).length },
        ]}
        activeFilter={filter}
        onFilterChange={setFilter}
      />

      {filteredItems.length === 0 ? (
        <section className="panel">
          <p className="empty">No customers match this search.</p>
        </section>
      ) : (
        <section className="record-grid reveal-grid">
          {filteredItems.map((customer) => (
            <article key={customer.id} className="record-card">
              <div className="record-header">
                <div>
                  <p className="catalog-kicker">Customer #{customer.id}</p>
                  <h3 className="record-title">
                    {[customer.first_name, customer.last_name].filter(Boolean).join(" ") || "Unnamed contact"}
                  </h3>
                  <p className="record-subtitle">{customer.external_ref || "No external ref"}</p>
                </div>
                <span className="chip">{formatDate(customer.created_at)}</span>
              </div>

              <dl className="record-meta-grid">
                <div>
                  <dt>Phone</dt>
                  <dd>{customer.phone || "-"}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{customer.email || "-"}</dd>
                </div>
              </dl>

              {customer.notes ? <p className="record-note mono">{customer.notes}</p> : null}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
