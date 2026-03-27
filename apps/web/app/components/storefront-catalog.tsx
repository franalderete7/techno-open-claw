"use client";

import Image from "next/image";
import Link from "next/link";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { buildStorefrontProductPath, type StorefrontProduct, type StorefrontProfile } from "../../lib/storefront";
import { StorefrontProductActions } from "./storefront-product-actions";

type StorefrontCatalogProps = {
  store: StorefrontProfile;
  products: StorefrontProduct[];
  eyebrow: string;
  title: string;
  lead: string;
};

const PAGE_SIZE = 12;
const FAQ_ITEMS = [
  {
    question: "Como funciona la compra?",
    answer:
      "Elegis el modelo, tocás 'Quiero pagarlo ahora' y seguimos la operacion por WhatsApp con el equipo ya seleccionado.",
  },
  {
    question: "Los precios ya estan en pesos?",
    answer:
      "Si. El valor que ves en cada card es el precio final publico en ARS para ese equipo.",
  },
  {
    question: "Hacen entrega o retiro?",
    answer:
      "Si. Coordinamos retiro en Salta o entrega segun el equipo y la disponibilidad publicada.",
  },
  {
    question: "Recibo un link de pago personalizado?",
    answer:
      "Si. Cuando avanzas por WhatsApp te enviamos el link de pago preparado para ese modelo y ese importe.",
  },
  {
    question: "Puedo comparar por RAM, memoria o precio?",
    answer:
      "Si. La barra de busqueda y los filtros de arriba estan pensados para encontrar rapido el equipo por marca, RAM, memoria o precio.",
  },
];

function formatMoney(amount: number | null) {
  if (amount == null) return "Consultar";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function buildWhatsAppUrl(baseUrl: string | null, message: string) {
  if (!baseUrl) return null;
  return `${baseUrl}?text=${encodeURIComponent(message)}`;
}

function buildSpecSummary(product: StorefrontProduct) {
  return [
    product.ram_gb ? `${product.ram_gb}GB RAM` : null,
    product.storage_gb ? `${product.storage_gb}GB` : null,
    product.network ? product.network.toUpperCase() : null,
    product.color,
  ].filter((value): value is string => Boolean(value));
}

function normalizeComparableText(value: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function normalizeComparableFragment(value: string | null) {
  return normalizeComparableText(value)
    .replace(/\b(storage|almacenamiento|memoria interna)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitComparableFragments(value: string | null) {
  return normalizeComparableText(value)
    .split(",")
    .map((fragment) => normalizeComparableFragment(fragment))
    .filter(Boolean);
}

function shouldRenderCardDescription(product: StorefrontProduct, specSummary: string[]) {
  if (!product.description) {
    return false;
  }

  const descriptionFragments = splitComparableFragments(product.description);
  if (descriptionFragments.length === 0) {
    return false;
  }

  const specFragments = specSummary.map((spec) => normalizeComparableFragment(spec));
  const coveredBySpecs = descriptionFragments.every((fragment) =>
    specFragments.some((spec) => spec === fragment || spec.includes(fragment) || fragment.includes(spec))
  );

  return !coveredBySpecs;
}

function ProductImage({ product }: { product: StorefrontProduct }) {
  const initials = product.brand.slice(0, 2).toUpperCase();
  const [failed, setFailed] = useState(false);

  if (!product.image_url || failed) {
    return (
      <div className="storefront-image-fallback">
        <span className="storefront-image-fallback-mark">{initials}</span>
        <span className="storefront-image-fallback-copy">Imagen a confirmar</span>
      </div>
    );
  }

  return (
    <img
      src={product.image_url}
      alt={product.title}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="storefront-product-image"
      onError={() => setFailed(true)}
    />
  );
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

function SearchSparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="storefront-search-icon">
      <path
        fill="currentColor"
        d="M10.5 3a7.5 7.5 0 0 1 5.93 12.1l4.23 4.22-1.41 1.42-4.23-4.23A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm.25 2.25c.41 0 .75.34.75.75v1.5H13a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0V11H8.5a.75.75 0 0 1 0-1.5H10V8c0-.41.34-.75.75-.75Z"
      />
    </svg>
  );
}

export function StorefrontCatalog({ store, products, eyebrow }: StorefrontCatalogProps) {
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState("all");
  const [ramFilter, setRamFilter] = useState("all");
  const [storageFilter, setStorageFilter] = useState("all");
  const [sort, setSort] = useState("featured");
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  const ramOptions = useMemo(
    () =>
      [...new Set(products.map((product) => product.ram_gb).filter((value): value is number => value != null))].sort(
        (left, right) => left - right
      ),
    [products]
  );
  const storageOptions = useMemo(
    () =>
      [...new Set(products.map((product) => product.storage_gb).filter((value): value is number => value != null))].sort(
        (left, right) => left - right
      ),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const next = products.filter((product) => {
      const matchesQuery =
        needle.length === 0 ||
        [
          product.brand,
          product.model,
          product.title,
          product.description ?? "",
          product.network ?? "",
          product.color ?? "",
          product.ram_gb ? `${product.ram_gb}gb ram` : "",
          product.storage_gb ? `${product.storage_gb}gb` : "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);

      const matchesAvailability =
        availability === "all" || (availability === "available" && product.in_stock);
      const matchesRam = ramFilter === "all" || String(product.ram_gb ?? "") === ramFilter;
      const matchesStorage = storageFilter === "all" || String(product.storage_gb ?? "") === storageFilter;

      return matchesQuery && matchesAvailability && matchesRam && matchesStorage;
    });

    next.sort((left, right) => {
      if (sort === "price-asc") {
        return (left.public_price_ars ?? Number.MAX_SAFE_INTEGER) - (right.public_price_ars ?? Number.MAX_SAFE_INTEGER);
      }

      if (sort === "price-desc") {
        return (right.public_price_ars ?? -1) - (left.public_price_ars ?? -1);
      }

      if (sort === "alphabetical") {
        return left.title.localeCompare(right.title, "es");
      }

      if (Number(right.in_stock) !== Number(left.in_stock)) {
        return Number(right.in_stock) - Number(left.in_stock);
      }

      return 0;
    });

    return next;
  }, [availability, needle, products, ramFilter, sort, storageFilter]);

  useEffect(() => {
    startTransition(() => {
      setPage(1);
    });
  }, [availability, needle, products.length, ramFilter, sort, storageFilter]);

  const availableCount = products.filter((product) => product.in_stock).length;
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedProducts = filteredProducts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageStart = filteredProducts.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, filteredProducts.length);
  const generalWhatsAppUrl = buildWhatsAppUrl(
    store.whatsapp_url,
    "Hola! Quiero comprar un equipo en TechnoStore Salta."
  );
  function goToPage(nextPage: number) {
    const bounded = Math.max(1, Math.min(totalPages, nextPage));
    setPage(bounded);

    if (typeof window !== "undefined") {
      document.getElementById("modelos")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <div className="storefront-stack">
      <header className="storefront-navbar">
        <div className="storefront-navbar-top">
          <Link href="/" className="storefront-navbar-brand">
            <Image src="/brand/logo-negro-salta.png" alt="TechnoStore Salta" width={108} height={28} priority />
            <span className="storefront-navbar-brand-copy">
              <strong>{store.name}</strong>
              <small>Smartphones en Salta</small>
            </span>
          </Link>

          {generalWhatsAppUrl ? (
            <a className="storefront-navbar-cta" href={generalWhatsAppUrl} target="_blank" rel="noreferrer">
              <WhatsAppIcon />
              WhatsApp
            </a>
          ) : null}
        </div>

        <div className="storefront-navbar-actions">
          <a href="#inicio" className="storefront-navbar-link">
            Inicio
          </a>
          <a href="#modelos" className="storefront-navbar-link">
            Equipos
          </a>
          <a href="#preguntas" className="storefront-navbar-link">
            FAQ
          </a>
          <a href="#ubicacion" className="storefront-navbar-link">
            Local
          </a>
        </div>
      </header>

      <div id="inicio" className="storefront-anchor" aria-hidden="true" />

      <section className="storefront-toolbar storefront-section" id="buscar">
        <div className="storefront-toolbar-meta">
          <span className="eyebrow">{eyebrow}</span>
          <div className="storefront-toolbar-stats" aria-label="Resumen del catalogo">
            <span className="chip accent">{products.length} equipos</span>
            <span className="chip good">{availableCount} publicados</span>
          </div>
        </div>

        <div className="storefront-searchbar">
          <label className="storefront-search">
            <span className="storefront-search-label">Buscar equipo</span>
            <div className="storefront-search-shell">
              <div className="storefront-search-field">
                <SearchSparkIcon />
                <input
                  type="search"
                  placeholder="iPhone, Xiaomi, Samsung, 8GB, 256GB..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>
          </label>

          <div className="storefront-toolbar-controls">
            <div className="storefront-filter-row">
              {[
                { value: "all", label: "Todos" },
                { value: "available", label: "Disponibles" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`storefront-filter ${availability === option.value ? "is-active" : ""}`}
                  onClick={() => setAvailability(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label className="storefront-select">
              <span>RAM</span>
              <select value={ramFilter} onChange={(event) => setRamFilter(event.target.value)}>
                <option value="all">Todas</option>
                {ramOptions.map((value) => (
                  <option key={value} value={String(value)}>
                    {value} GB
                  </option>
                ))}
              </select>
            </label>

            <label className="storefront-select">
              <span>Memoria</span>
              <select value={storageFilter} onChange={(event) => setStorageFilter(event.target.value)}>
                <option value="all">Todas</option>
                {storageOptions.map((value) => (
                  <option key={value} value={String(value)}>
                    {value} GB
                  </option>
                ))}
              </select>
            </label>

            <label className="storefront-select">
              <span>Ordenar</span>
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="featured">Destacados</option>
                <option value="price-asc">Precio menor</option>
                <option value="price-desc">Precio mayor</option>
                <option value="alphabetical">A-Z</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      {filteredProducts.length === 0 ? (
        <section className="panel storefront-empty-state">
          <p className="empty">No encontré modelos con ese filtro. Probá otra marca, RAM o memoria.</p>
        </section>
      ) : (
        <>
          <section className="storefront-grid" id="modelos">
            {pagedProducts.map((product) => {
              const detailHref = buildStorefrontProductPath(product.sku);
              const specSummary = buildSpecSummary(product);
              const shouldShowDescription = shouldRenderCardDescription(product, specSummary);

              return (
                <article key={product.id} className="storefront-card storefront-card-clickable">
                  <Link href={detailHref} className="storefront-card-overlay-link" aria-label={`Abrir ${product.title}`} />
                  <div className="storefront-card-media">
                    <div className="storefront-card-media-link">
                      <ProductImage product={product} />
                    </div>
                    <div className="storefront-status-row">
                      <span className="chip accent mono">{product.sku}</span>
                      <span className={`chip ${product.in_stock ? "good" : "warn"}`}>
                        {product.in_stock ? "Disponible" : "Consultar disponibilidad"}
                      </span>
                    </div>
                  </div>

                  <div className="storefront-card-body">
                    <div className="storefront-card-header">
                      <p className="catalog-kicker">{product.brand}</p>
                      <h3 className="storefront-card-title">{product.title}</h3>
                      {product.model ? <p className="storefront-card-subtitle">{product.model}</p> : null}
                    </div>

                    {specSummary.length > 0 ? (
                      <div className="storefront-spec-list">
                        {specSummary.map((spec) => (
                          <span key={spec} className="storefront-spec-chip">
                            {spec}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {shouldShowDescription ? <p className="storefront-card-copy">{product.description}</p> : null}

                    <div className="storefront-card-footer">
                      <div className="storefront-card-action-stack">
                        <div className="storefront-price-stack">
                          <p className="storefront-price-label">Precio final</p>
                          <strong className="storefront-price">{formatMoney(product.public_price_ars)}</strong>
                          <p className="storefront-price-note">
                            {product.delivery_days
                              ? `Entrega estimada en ${product.delivery_days} días`
                              : "Retiro o entrega coordinada"}
                          </p>
                        </div>
                        <StorefrontProductActions
                          product={product}
                          whatsappUrl={store.whatsapp_url}
                          sourcePath="/"
                          detailHref={detailHref}
                        />
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          <div className="storefront-pagination">
            <span className="storefront-load-more-copy">
              Mostrando {pageStart}-{pageEnd} de {filteredProducts.length} equipos.
            </span>
            <div className="storefront-pagination-actions">
              <button
                type="button"
                className="storefront-filter"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
              >
                Anterior
              </button>
              {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  className={`storefront-filter ${pageNumber === currentPage ? "is-active" : ""}`}
                  onClick={() => goToPage(pageNumber)}
                >
                  {pageNumber}
                </button>
              ))}
              <button
                type="button"
                className="storefront-filter"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                Siguiente
              </button>
            </div>
          </div>
        </>
      )}

      <section className="storefront-faq storefront-section" id="preguntas">
        <div className="storefront-faq-copy">
          <span className="eyebrow">FAQ</span>
          <h2 className="storefront-location-title">Compra clara y directa.</h2>
          <p className="storefront-location-lead">
            Todo lo importante para elegir el equipo, avanzar por WhatsApp y resolver pago, retiro o entrega sin
            vueltas.
          </p>
        </div>

        <div className="storefront-faq-list">
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} className="storefront-faq-item">
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="storefront-location storefront-section" id="ubicacion">
        <div className="storefront-location-copy">
          <span className="eyebrow">Visitanos</span>
          <h2 className="storefront-location-title">Atención presencial en Salta</h2>
          <p className="storefront-location-lead">
            Coordiná por WhatsApp, resolvé el pago y pasá por el local cuando quieras cerrar retiro o entrega.
          </p>
          <div className="storefront-location-details">
            {store.address ? (
              <div>
                <span className="storefront-location-label">Dirección</span>
                <strong>{store.address}</strong>
              </div>
            ) : null}
            {store.hours ? (
              <div>
                <span className="storefront-location-label">Horario</span>
                <strong>{store.hours}</strong>
              </div>
            ) : null}
          </div>
          {generalWhatsAppUrl ? (
            <a className="storefront-navbar-cta" href={generalWhatsAppUrl} target="_blank" rel="noreferrer">
              <WhatsAppIcon />
              Hablar por WhatsApp
            </a>
          ) : null}
        </div>

        {store.map_embed_url ? (
          <div className="storefront-map-frame">
            <iframe
              src={store.map_embed_url}
              title={`Mapa de ${store.name}`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
        ) : null}
      </section>

      <footer className="storefront-footer">
        <div className="storefront-footer-facts">
          <span>Precios publicos en ARS</span>
          <span>Pago por link</span>
          <span>Atencion directa</span>
        </div>
        <p>Hecho con amor en Salta.</p>
      </footer>
    </div>
  );
}
