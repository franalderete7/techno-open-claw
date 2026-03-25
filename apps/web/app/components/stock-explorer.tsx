"use client";

import { useDeferredValue, useState } from "react";
import type { StockRecord } from "../../lib/api";
import { SearchToolbar } from "./search-toolbar";

type StockExplorerProps = {
  items: StockRecord[];
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("es-AR", { dateStyle: "medium" });
}

export function StockExplorer({ items }: StockExplorerProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  const filteredItems = items.filter((item) => {
    const matchesQuery =
      needle.length === 0 ||
      [
        item.sku,
        item.brand,
        item.model,
        item.title,
        item.serial_number ?? "",
        item.location_code ?? "",
        item.color ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);

    const matchesFilter = filter === "all" || item.status === filter;
    return matchesQuery && matchesFilter;
  });

  const statuses = ["all", "in_stock", "reserved", "sold", "damaged"];

  return (
    <div className="page-stack">
      <SearchToolbar
        label="Search stock units"
        placeholder="Search by SKU, serial, title, color, or location"
        query={query}
        onQueryChange={setQuery}
        totalCount={items.length}
        resultCount={filteredItems.length}
        filters={statuses.map((status) => ({
          value: status,
          label: status === "all" ? "All" : status.replace(/_/g, " "),
          count: status === "all" ? items.length : items.filter((item) => item.status === status).length,
        }))}
        activeFilter={filter}
        onFilterChange={setFilter}
      />

      {filteredItems.length === 0 ? (
        <section className="panel">
          <p className="empty">No stock units match this search.</p>
        </section>
      ) : (
        <section className="record-grid reveal-grid">
          {filteredItems.map((unit) => (
            <article key={unit.id} className="record-card">
              <div className="record-header">
                <div>
                  <p className="catalog-kicker">Unit #{unit.id}</p>
                  <h3 className="record-title">
                    {unit.brand} {unit.model}
                  </h3>
                  <p className="record-subtitle">{unit.title}</p>
                </div>
                <span
                  className={`pill ${
                    unit.status === "in_stock"
                      ? "good"
                      : unit.status === "reserved"
                        ? "warn"
                        : unit.status === "damaged"
                          ? "danger"
                          : ""
                  }`}
                >
                  {unit.status.replace(/_/g, " ")}
                </span>
              </div>

              <div className="chip-row">
                <span className="chip accent mono">{unit.sku}</span>
                {unit.serial_number ? <span className="chip mono">{unit.serial_number}</span> : null}
                {unit.color ? <span className="chip">{unit.color}</span> : null}
                {unit.battery_health != null ? (
                  <span className={`chip ${unit.battery_health >= 85 ? "good" : "warn"}`}>{unit.battery_health}% battery</span>
                ) : null}
              </div>

              <dl className="record-meta-grid">
                <div>
                  <dt>Location</dt>
                  <dd>{unit.location_code || "-"}</dd>
                </div>
                <div>
                  <dt>Acquired</dt>
                  <dd>{formatDate(unit.acquired_at)}</dd>
                </div>
                <div>
                  <dt>Sold</dt>
                  <dd>{formatDate(unit.sold_at)}</dd>
                </div>
                <div>
                  <dt>Cost</dt>
                  <dd>
                    {unit.cost_amount == null ? "-" : new Intl.NumberFormat("es-AR", { style: "currency", currency: unit.currency_code }).format(unit.cost_amount)}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
