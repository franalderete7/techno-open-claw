"use client";

import Image from "next/image";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import type { StorefrontProduct, StorefrontProfile } from "../../lib/storefront";

type StorefrontCatalogProps = {
  store: StorefrontProfile;
  products: StorefrontProduct[];
  eyebrow: string;
  title: string;
  lead: string;
};

function formatMoney(amount: number | null) {
  if (amount == null) return "Consultar";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function buildWhatsAppUrl(baseUrl: string | null, product: StorefrontProduct) {
  if (!baseUrl) return null;
  const message = `Hola! Quiero consultar por ${product.title}.`;
  return `${baseUrl}?text=${encodeURIComponent(message)}`;
}

function ProductImage({ product }: { product: StorefrontProduct }) {
  const initials = product.brand.slice(0, 2).toUpperCase();

  if (!product.image_url) {
    return <div className="storefront-image-fallback">{initials}</div>;
  }

  return <img src={product.image_url} alt={product.title} loading="lazy" className="storefront-product-image" />;
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="storefront-whatsapp-icon">
      <path
        fill="currentColor"
        d="M19.1 4.9A9.94 9.94 0 0 0 12.03 2C6.5 2 2 6.47 2 12c0 1.76.46 3.47 1.32 4.98L2 22l5.17-1.28A9.93 9.93 0 0 0 12.03 22C17.56 22 22 17.53 22 12c0-2.68-1.04-5.2-2.9-7.1Zm-7.07 15.4a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3.06.76.82-2.98-.2-.31A8.2 8.2 0 0 1 3.82 12c0-4.53 3.68-8.21 8.21-8.21 2.2 0 4.28.86 5.84 2.42A8.18 8.18 0 0 1 20.24 12c0 4.53-3.68 8.21-8.21 8.21Zm4.5-6.16c-.25-.12-1.48-.73-1.71-.82-.23-.08-.4-.12-.57.12-.17.25-.65.82-.8.98-.15.17-.29.19-.54.06-.25-.12-1.05-.39-2-1.25-.74-.66-1.23-1.48-1.38-1.73-.14-.25-.02-.38.1-.5.11-.11.25-.29.37-.43.12-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.12-.57-1.37-.78-1.87-.21-.5-.42-.43-.57-.44h-.49c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.24.9 2.43 1.02 2.6.12.17 1.77 2.7 4.29 3.78.6.26 1.07.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.48-.61 1.69-1.21.21-.6.21-1.11.15-1.21-.06-.1-.23-.17-.48-.29Z"
      />
    </svg>
  );
}

export function StorefrontCatalog({ store, products, eyebrow, title, lead }: StorefrontCatalogProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesQuery =
        needle.length === 0 ||
        [
          product.brand,
          product.model,
          product.title,
          product.description ?? "",
          product.network ?? "",
          product.color ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);

      const matchesFilter =
        filter === "all" ||
        (filter === "available" && product.in_stock) ||
        (filter === "new" && product.condition === "new") ||
        (filter === "used" && product.condition !== "new");

      return matchesQuery && matchesFilter;
    });
  }, [filter, needle, products]);

  const availableCount = products.filter((product) => product.in_stock).length;

  return (
    <div className="storefront-stack">
      <section className="storefront-hero">
        <div className="storefront-hero-copy">
          <div className="storefront-topline">
            <Image src="/brand/logo-negro-salta.png" alt="" width={92} height={24} priority />
            <span className="eyebrow">{eyebrow}</span>
          </div>
          <h1 className="storefront-title">{title}</h1>
          <p className="storefront-lead">{lead}</p>
          <div className="chip-row">
            <span className="chip accent">{products.length} modelos</span>
            <span className="chip good">{availableCount} con entrega</span>
            {store.address ? <span className="chip">{store.address}</span> : null}
          </div>
        </div>

        <aside className="storefront-callout">
          <p className="storefront-callout-label">Atención directa</p>
          <h2>{store.name}</h2>
          <p>{store.tagline}</p>
          {store.hours ? <p className="storefront-callout-meta">Horario: {store.hours}</p> : null}
          {store.whatsapp_url ? (
            <a className="storefront-whatsapp-button" href={`${store.whatsapp_url}?text=${encodeURIComponent("Hola! Quiero consultar el catálogo.")}`} target="_blank" rel="noreferrer">
              <WhatsAppIcon />
              WhatsApp
            </a>
          ) : null}
        </aside>
      </section>

      <section className="storefront-toolbar">
        <label className="storefront-search">
          <span className="storefront-search-label">Buscar</span>
          <input
            type="search"
            placeholder="iPhone, Xiaomi, Samsung, memoria, color..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="storefront-filter-row">
          {[
            { value: "all", label: "Todo" },
            { value: "available", label: "Disponibles" },
            { value: "new", label: "Nuevos" },
            { value: "used", label: "Usados" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              className={`storefront-filter ${filter === option.value ? "is-active" : ""}`}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="storefront-grid">
        {filteredProducts.map((product) => {
          const whatsappUrl = buildWhatsAppUrl(store.whatsapp_url, product);

          return (
            <article key={product.id} className="storefront-card">
              <div className="storefront-card-media">
                <ProductImage product={product} />
                <div className="storefront-status-row">
                  <span className={`chip ${product.in_stock ? "good" : "warn"}`}>{product.in_stock ? "Disponible" : "Consultar"}</span>
                  <span className="chip">{product.condition === "new" ? "Nuevo" : "Usado"}</span>
                </div>
              </div>

              <div className="storefront-card-body">
                <p className="catalog-kicker">{product.brand}</p>
                <h3 className="storefront-card-title">{product.title}</h3>
                <p className="storefront-card-subtitle">{product.model}</p>

                <div className="chip-row">
                  {product.ram_gb ? <span className="chip">{product.ram_gb}GB RAM</span> : null}
                  {product.storage_gb ? <span className="chip">{product.storage_gb}GB</span> : null}
                  {product.network ? <span className="chip">{product.network.toUpperCase()}</span> : null}
                  {product.color ? <span className="chip">{product.color}</span> : null}
                  {product.delivery_days ? <span className="chip">{product.delivery_days} días</span> : null}
                </div>

                {product.description ? <p className="storefront-card-copy">{product.description}</p> : null}

                <div className="storefront-card-footer">
                  <div>
                    <p className="storefront-price-label">Precio</p>
                    <strong className="storefront-price">{formatMoney(product.public_price_ars)}</strong>
                    <p className="storefront-price-note">
                      {product.delivery_days ? `Entrega estimada en ${product.delivery_days} días` : "Consulta entrega y retiro"}
                    </p>
                  </div>

                  {whatsappUrl ? (
                    <a className="storefront-whatsapp-button" href={whatsappUrl} target="_blank" rel="noreferrer">
                      <WhatsAppIcon />
                      Consultar
                    </a>
                  ) : (
                    <span className="storefront-whatsapp-button is-disabled">
                      <WhatsAppIcon />
                      Sin WhatsApp
                    </span>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <footer className="storefront-footer">
        <div>
          <strong>{store.name}</strong>
          {store.address ? <p>{store.address}</p> : null}
        </div>
        <div className="storefront-footer-links">
          <Link href="/">Inicio</Link>
          <Link href="/products">Catálogo</Link>
          {store.whatsapp_url ? (
            <a href={`${store.whatsapp_url}?text=${encodeURIComponent("Hola! Quiero consultar el catálogo.")}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
