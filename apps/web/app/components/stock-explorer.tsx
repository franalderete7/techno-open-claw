"use client";

import { useDeferredValue, useState } from "react";
import type { StockRecord } from "../../lib/api";
import { SearchToolbar } from "./search-toolbar";

type StockExplorerProps = {
  items: StockRecord[];
};

type FieldRow = {
  label: string;
  value: string;
  mono?: boolean;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("es-AR", { dateStyle: "medium" });
}

function formatNullable(value: unknown) {
  if (value == null || value === "") return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function buildStockFields(unit: StockRecord): FieldRow[] {
  return [
    { label: "id", value: String(unit.id), mono: true },
    { label: "product_id", value: String(unit.product_id), mono: true },
    { label: "inventory_purchase_id", value: String(unit.inventory_purchase_id), mono: true },
    { label: "sku", value: unit.sku, mono: true },
    { label: "serial_number", value: formatNullable(unit.serial_number), mono: true },
    { label: "imei_1", value: formatNullable(unit.imei_1), mono: true },
    { label: "imei_2", value: formatNullable(unit.imei_2), mono: true },
    { label: "status", value: unit.status },
    { label: "color", value: formatNullable(unit.color) },
    { label: "battery_health", value: formatNullable(unit.battery_health) },
    { label: "location_code", value: formatNullable(unit.location_code) },
    { label: "cost_amount", value: formatNullable(unit.cost_amount) },
    { label: "currency_code", value: unit.currency_code, mono: true },
    { label: "acquired_at", value: formatNullable(unit.acquired_at), mono: true },
    { label: "sold_at", value: formatNullable(unit.sold_at), mono: true },
    { label: "metadata", value: formatNullable(unit.metadata), mono: true },
    { label: "brand", value: unit.brand },
    { label: "model", value: unit.model },
    { label: "title", value: unit.title },
  ];
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
        item.imei_1 ?? "",
        item.imei_2 ?? "",
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
        placeholder="Search by SKU, serial, IMEI, title, color, or location"
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
          {filteredItems.map((unit) => {
            const fields = buildStockFields(unit);

            return (
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
                <span className="chip mono">Purchase #{unit.inventory_purchase_id}</span>
                {unit.serial_number ? <span className="chip mono">{unit.serial_number}</span> : null}
                {unit.imei_1 ? <span className="chip mono">IMEI1 {unit.imei_1}</span> : null}
                {unit.imei_2 ? <span className="chip mono">IMEI2 {unit.imei_2}</span> : null}
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

              <details className="field-details">
                <summary className="field-summary">Full row · {fields.length} fields</summary>
                <dl className="field-grid">
                  {fields.map((field) => (
                    <div key={field.label} className="field-row">
                      <dt>{field.label}</dt>
                      <dd className={field.mono ? "mono" : undefined}>{field.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
