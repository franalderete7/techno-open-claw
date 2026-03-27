"use client";

import { useDeferredValue, useState } from "react";
import type { ProductRecord } from "../../lib/api";
import { SearchToolbar } from "./search-toolbar";

type ProductsExplorerProps = {
  items: ProductRecord[];
};

type FieldRow = {
  label: string;
  value: string;
  mono?: boolean;
  href?: string | null;
};

type ProductSection = {
  title: string;
  fields: FieldRow[];
};

function summarizeSection(section: ProductSection) {
  const visibleCount = section.fields.filter((field) => field.value !== "null" && field.value !== "").length;
  return `${visibleCount || section.fields.length} fields`;
}

function formatMoney(amount: number | null, currency: string) {
  if (amount == null) return "Price not loaded";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("es-AR", { dateStyle: "medium" });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatNullable(value: unknown) {
  if (value == null || value === "") return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatMoneyField(amount: number | null | undefined, currency: string) {
  if (amount == null) return "null";
  return formatMoney(amount, currency);
}

function formatPercent(value: number | null | undefined) {
  if (value == null) return "null";
  return `${value}%`;
}

function buildProductSections(product: ProductRecord): ProductSection[] {
  return [
    {
      title: "Identity",
      fields: [
        { label: "id", value: String(product.id), mono: true },
        { label: "legacy_source_id", value: formatNullable(product.legacy_source_id), mono: true },
        { label: "sku", value: product.sku, mono: true },
        { label: "slug", value: product.slug, mono: true },
        { label: "brand", value: product.brand },
        { label: "model", value: product.model },
        { label: "title", value: product.title },
        { label: "category", value: formatNullable(product.category) },
        { label: "condition", value: product.condition },
        { label: "active", value: formatNullable(product.active) },
      ],
    },
    {
      title: "Pricing",
      fields: [
        { label: "currency_code", value: product.currency_code, mono: true },
        { label: "price_amount", value: formatMoneyField(product.price_amount, product.currency_code) },
        { label: "promo_price_ars", value: formatMoneyField(product.promo_price_ars, product.currency_code) },
        { label: "price_usd", value: formatNullable(product.price_usd) },
        { label: "cost_usd", value: formatNullable(product.cost_usd) },
        { label: "logistics_usd", value: formatNullable(product.logistics_usd) },
        { label: "total_cost_usd", value: formatNullable(product.total_cost_usd) },
        { label: "margin_pct", value: formatPercent(product.margin_pct) },
        { label: "usd_rate", value: formatNullable(product.usd_rate) },
      ],
    },
    {
      title: "Financing",
      fields: [
        { label: "bancarizada_total", value: formatNullable(product.bancarizada_total) },
        { label: "bancarizada_cuota", value: formatNullable(product.bancarizada_cuota) },
        { label: "bancarizada_interest", value: formatPercent(product.bancarizada_interest) },
        { label: "macro_total", value: formatNullable(product.macro_total) },
        { label: "macro_cuota", value: formatNullable(product.macro_cuota) },
        { label: "macro_interest", value: formatPercent(product.macro_interest) },
        { label: "cuotas_qty", value: formatNullable(product.cuotas_qty) },
      ],
    },
    {
      title: "Specs",
      fields: [
        { label: "ram_gb", value: formatNullable(product.ram_gb) },
        { label: "storage_gb", value: formatNullable(product.storage_gb) },
        { label: "network", value: formatNullable(product.network) },
        { label: "color", value: formatNullable(product.color) },
        { label: "battery_health", value: formatPercent(product.battery_health) },
        { label: "description", value: formatNullable(product.description) },
        { label: "image_url", value: formatNullable(product.image_url), mono: true, href: product.image_url },
      ],
    },
    {
      title: "Inventory",
      fields: [
        { label: "in_stock", value: formatNullable(product.in_stock) },
        { label: "stock_units_total", value: String(product.stock_units_total), mono: true },
        { label: "stock_units_available", value: String(product.stock_units_available), mono: true },
        { label: "stock_units_reserved", value: String(product.stock_units_reserved), mono: true },
        { label: "stock_units_sold", value: String(product.stock_units_sold), mono: true },
      ],
    },
    {
      title: "Delivery",
      fields: [
        { label: "delivery_type", value: formatNullable(product.delivery_type) },
        { label: "delivery_days", value: formatNullable(product.delivery_days) },
      ],
    },
    {
      title: "Timeline",
      fields: [
        { label: "created_at", value: formatDateTime(product.created_at), mono: true },
        { label: "updated_at", value: formatDateTime(product.updated_at), mono: true },
      ],
    },
  ];
}

function ProductThumbnail({ product }: { product: ProductRecord }) {
  const [failed, setFailed] = useState(false);

  if (!product.image_url || failed) {
    return <div className="product-placeholder">{product.brand.slice(0, 2).toUpperCase()}</div>;
  }

  return <img src={product.image_url} alt={product.title} loading="lazy" onError={() => setFailed(true)} />;
}

function ProductFieldValue({ field }: { field: FieldRow }) {
  if (field.href) {
    return (
      <a className="field-link" href={field.href} target="_blank" rel="noreferrer">
        Open asset
      </a>
    );
  }

  return <>{field.value}</>;
}

export function ProductsExplorer({ items }: ProductsExplorerProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  const filteredItems = items.filter((product) => {
    const matchesQuery =
      needle.length === 0 ||
      [
        product.sku,
        product.brand,
        product.model,
        product.title,
        product.description ?? "",
        product.color ?? "",
        product.network ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);

    const matchesFilter =
      filter === "all" ||
      (filter === "active" && product.active) ||
      (filter === "in_stock" && product.in_stock) ||
      (filter === "inactive" && !product.active) ||
      (filter === "needs_stock" && product.stock_units_available === 0);

    return matchesQuery && matchesFilter;
  });

  const filterOptions = [
    { value: "all", label: "All", count: items.length },
    { value: "active", label: "Active", count: items.filter((item) => item.active).length },
    { value: "in_stock", label: "In stock", count: items.filter((item) => item.in_stock).length },
    { value: "needs_stock", label: "Needs stock", count: items.filter((item) => item.stock_units_available === 0).length },
  ];

  return (
    <div className="page-stack">
      <SearchToolbar
        label="Search catalog"
        placeholder="Search by SKU, model, title, color, or network"
        query={query}
        onQueryChange={setQuery}
        totalCount={items.length}
        resultCount={filteredItems.length}
        filters={filterOptions}
        activeFilter={filter}
        onFilterChange={setFilter}
      />

      {filteredItems.length === 0 ? (
        <section className="panel">
          <p className="empty">No products match this search.</p>
        </section>
      ) : (
        <section className="product-list reveal-grid">
          {filteredItems.map((product) => {
            const sections = buildProductSections(product);

            return (
              <article key={product.id} className="product-card">
                <div className="product-thumb">
                  <ProductThumbnail product={product} />
                </div>

                <div className="product-body">
                  <div className="product-header-row">
                    <div className="product-main">
                      <div>
                        <p className="catalog-kicker">{product.brand}</p>
                        <h3 className="product-heading">{product.title}</h3>
                        <p className="product-subline">{product.model}</p>
                      </div>

                      <div className="chip-row">
                        <span className={`chip ${product.active ? "good" : "warn"}`}>
                          {product.active ? "Active" : "Inactive"}
                        </span>
                        <span className={`chip ${product.in_stock ? "good" : "danger"}`}>
                          {product.in_stock ? "In stock" : "Out"}
                        </span>
                        {product.ram_gb ? <span className="chip">{product.ram_gb}GB RAM</span> : null}
                        {product.storage_gb ? <span className="chip">{product.storage_gb}GB</span> : null}
                        {product.network ? <span className="chip">{product.network.toUpperCase()}</span> : null}
                        {product.color ? <span className="chip">{product.color}</span> : null}
                      </div>

                      {product.description ? <p className="product-copy">{product.description}</p> : null}
                    </div>

                    <div className="product-side">
                      <div className="price-stack">
                        <span>Promo</span>
                        <strong>{formatMoney(product.promo_price_ars ?? product.price_amount, product.currency_code)}</strong>
                        {product.promo_price_ars && product.price_amount && product.promo_price_ars !== product.price_amount ? (
                          <span className="price-note">List {formatMoney(product.price_amount, product.currency_code)}</span>
                        ) : (
                          <span className="price-note">Updated {formatDate(product.updated_at)}</span>
                        )}
                      </div>

                      <div className="metric-grid">
                        <div className="metric">
                          <span className="metric-label">Available</span>
                          <strong className="metric-value">{product.stock_units_available}</strong>
                        </div>
                        <div className="metric">
                          <span className="metric-label">Total</span>
                          <strong className="metric-value">{product.stock_units_total}</strong>
                        </div>
                        <div className="metric">
                          <span className="metric-label">Sold</span>
                          <strong className="metric-value">{product.stock_units_sold}</strong>
                        </div>
                        <div className="metric">
                          <span className="metric-label">USD</span>
                          <strong className="metric-value">{product.price_usd == null ? "-" : `$${product.price_usd}`}</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="product-section-grid">
                    {sections.map((section) => (
                      <details key={section.title} className="field-details product-section-card product-fold">
                        <summary className="field-summary fold-summary">
                          <span>{section.title}</span>
                          <span className="fold-meta">{summarizeSection(section)}</span>
                        </summary>
                        <dl className="field-grid product-field-grid">
                          {section.fields.map((field) => (
                            <div key={field.label} className="field-row">
                              <dt>{field.label}</dt>
                              <dd className={field.mono ? "mono" : undefined}>
                                <ProductFieldValue field={field} />
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
