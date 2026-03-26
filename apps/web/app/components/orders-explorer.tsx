"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import type { OrderRecord } from "../../lib/api";
import { SearchToolbar } from "./search-toolbar";

type OrdersExplorerProps = {
  items: OrderRecord[];
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatMoney(amount: number | null, currency: string) {
  if (amount == null) return "-";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function OrdersExplorer({ items }: OrdersExplorerProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  const filteredItems = items.filter((order) => {
    const matchesQuery =
      needle.length === 0 ||
      [
        order.order_number,
        order.status,
        order.source,
        order.phone ?? "",
        order.first_name ?? "",
        order.last_name ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);

    const matchesFilter = filter === "all" || order.status === filter;
    return matchesQuery && matchesFilter;
  });

  const distinctStatuses = Array.from(new Set(items.map((item) => item.status)));

  return (
    <div className="page-stack">
      <SearchToolbar
        label="Search orders"
        placeholder="Search by order number, source, customer, phone, or status"
        query={query}
        onQueryChange={setQuery}
        totalCount={items.length}
        resultCount={filteredItems.length}
        filters={[
          { value: "all", label: "All", count: items.length },
          ...distinctStatuses.map((status) => ({
            value: status,
            label: status,
            count: items.filter((item) => item.status === status).length,
          })),
        ]}
        activeFilter={filter}
        onFilterChange={setFilter}
      />

      {filteredItems.length === 0 ? (
        <section className="panel">
          <p className="empty">No orders match this search.</p>
        </section>
      ) : (
        <section className="record-grid reveal-grid">
          {filteredItems.map((order) => (
            <article key={order.id} className="record-card">
              <div className="record-header">
                <div>
                  <p className="catalog-kicker">{order.source}</p>
                  <h3 className="record-title">{order.order_number}</h3>
                  <p className="record-subtitle">
                    {order.customer_name || [order.first_name, order.last_name].filter(Boolean).join(" ") || "No customer"}
                  </p>
                </div>
                <span className={`pill ${order.status === "paid" || order.status === "fulfilled" ? "good" : "warn"}`}>
                  {order.status}
                </span>
              </div>

              <dl className="record-meta-grid">
                <div>
                  <dt>Total</dt>
                  <dd>{formatMoney(order.total_amount, order.currency_code)}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{order.phone || "-"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(order.created_at)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatDate(order.updated_at)}</dd>
                </div>
              </dl>

              <div className="meta-row">
                <Link href={`/orders/${order.id}`} className="chip action-link">
                  Open order
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
