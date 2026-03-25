"use client";

import { useDeferredValue, useState } from "react";
import type { ProductRecord } from "../../lib/api";
import { SearchToolbar } from "./search-toolbar";

type ProductsExplorerProps = {
  items: ProductRecord[];
};

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

function ProductThumbnail({ product }: { product: ProductRecord }) {
  const [failed, setFailed] = useState(false);

  if (!product.image_url || failed) {
    return <div className="product-placeholder">{product.brand.slice(0, 2).toUpperCase()}</div>;
  }

  return <img src={product.image_url} alt={product.title} loading="lazy" onError={() => setFailed(true)} />;
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
          {filteredItems.map((product) => (
            <article key={product.id} className="product-card">
              <div className="product-thumb">
                <ProductThumbnail product={product} />
              </div>

              <div className="product-main">
                <div>
                  <p className="catalog-kicker">{product.brand}</p>
                  <h3 className="product-heading">{product.title}</h3>
                  <p className="product-subline">{product.model}</p>
                </div>

                <div className="chip-row">
                  <span className="chip accent mono">{product.sku}</span>
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
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
