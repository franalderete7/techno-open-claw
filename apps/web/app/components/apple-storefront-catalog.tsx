"use client";

import Image from "next/image";
import Link from "next/link";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { trackMetaContact } from "../../lib/meta-pixel";
import { buildStorefrontConsultUrl, type StorefrontProduct, type StorefrontProfile } from "../../lib/storefront";
import { trackStorefrontEvent, trackStorefrontSearch } from "../../lib/storefront-analytics";

type AppleStorefrontCatalogProps = {
  store: StorefrontProfile;
  products: StorefrontProduct[];
};

const PAGE_SIZE = 9;
const APPLE_SUPPORT_COPY = "Garantía de 1 año · Envío nacional · 6 cuotas";

function formatMoney(amount: number | null) {
  if (amount == null) return "Consultar";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function buildAppleProductPath(sku: string) {
  return `/iphone/${encodeURIComponent(sku.trim().toLowerCase())}`;
}

function buildAppleProductUrl(storefrontUrl: string | null, sku: string) {
  const path = buildAppleProductPath(sku);
  if (!storefrontUrl) {
    return path;
  }

  return `${storefrontUrl.replace(/\/$/, "")}${path}`;
}

function splitAppleHeadline(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
    return [value.trim()];
  }

  return [words.slice(0, 2).join(" "), words.slice(2).join(" ")];
}

function buildAppleSpecLine(product: StorefrontProduct) {
  return [product.color, product.storage_gb ? `${product.storage_gb}GB` : null].filter(Boolean).join(" · ");
}

function ProductImage({ product, eager = false }: { product: StorefrontProduct; eager?: boolean }) {
  const initials = product.brand.slice(0, 2).toUpperCase();
  const [failed, setFailed] = useState(false);

  if (!product.image_url || failed) {
    return (
      <div className="apple-phone-fallback">
        <span className="apple-phone-fallback-mark">{initials}</span>
        <span className="apple-phone-fallback-copy">Imagen a confirmar</span>
      </div>
    );
  }

  return (
    <img
      src={product.image_url}
      alt={product.title}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      className="apple-phone-image"
      onError={() => setFailed(true)}
    />
  );
}

function AppleTierPill() {
  return <span className="apple-tier-pill">APPLE PREMIUM</span>;
}

function AppleWhatsAppButton({
  product,
  whatsappUrl,
  sourcePath,
}: {
  product: Pick<StorefrontProduct, "id" | "sku" | "title" | "brand" | "public_price_ars">;
  whatsappUrl: string | null;
  sourcePath: string;
}) {
  const consultUrl = buildStorefrontConsultUrl(whatsappUrl, product);

  if (!consultUrl) {
    return null;
  }

  return (
    <a
      className="apple-whatsapp-button"
      href={consultUrl}
      target="_blank"
      rel="noreferrer"
      onClick={() => {
        trackMetaContact({
          sku: product.sku,
          title: product.title,
          brand: product.brand,
          value: product.public_price_ars,
          currency: "ARS",
        });
        trackStorefrontEvent("contact", {
          product_id: product.id,
          sku: product.sku,
          value_amount: product.public_price_ars,
          currency_code: "ARS",
          payload: {
            title: product.title,
            brand: product.brand,
            channel: "whatsapp",
            placement: "iphone_storefront_card",
          },
        });
      }}
      data-fast-goal="click_consultar"
      data-fast-goal-product-id={String(product.id)}
      data-fast-goal-product-sku={product.sku}
      data-fast-goal-product-title={product.title}
      data-fast-goal-price-ars={product.public_price_ars != null ? String(product.public_price_ars) : undefined}
      data-fast-goal-source-path={sourcePath}
    >
      Consultar por WhatsApp
    </a>
  );
}

export function AppleStorefrontCatalog({ store, products }: AppleStorefrontCatalogProps) {
  const [query, setQuery] = useState("");
  const [storageFilter, setStorageFilter] = useState("all");
  const [colorFilter, setColorFilter] = useState("all");
  const [sort, setSort] = useState("premium");
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();
  const lastTrackedSearchKeyRef = useRef("");

  const storageOptions = useMemo(
    () =>
      [...new Set(products.map((product) => product.storage_gb).filter((value): value is number => Number.isFinite(value ?? NaN)))]
        .sort((left, right) => left - right),
    [products]
  );
  const colorOptions = useMemo(
    () =>
      [...new Set(products.map((product) => product.color?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) =>
        a.localeCompare(b, "es")
      ),
    [products]
  );

  const featuredProduct = useMemo(() => {
    return (
      products.find((product) => product.sku.toLowerCase().includes("iphone-17-pro-max")) ||
      [...products].sort((left, right) => (right.public_price_ars ?? 0) - (left.public_price_ars ?? 0))[0] ||
      null
    );
  }, [products]);

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
          product.storage_gb ? `${product.storage_gb}gb` : "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);

      const matchesStorage = storageFilter === "all" || String(product.storage_gb ?? "") === storageFilter;
      const matchesColor = colorFilter === "all" || (product.color ?? "").toLowerCase() === colorFilter.toLowerCase();

      return matchesQuery && matchesStorage && matchesColor;
    });

    next.sort((left, right) => {
      if (sort === "price-asc") {
        return (left.public_price_ars ?? Number.MAX_SAFE_INTEGER) - (right.public_price_ars ?? Number.MAX_SAFE_INTEGER);
      }

      if (sort === "alphabetical") {
        return left.title.localeCompare(right.title, "es");
      }

      return (right.public_price_ars ?? -1) - (left.public_price_ars ?? -1);
    });

    return next;
  }, [colorFilter, needle, products, sort, storageFilter]);

  useEffect(() => {
    startTransition(() => {
      setPage(1);
    });
  }, [needle, storageFilter, colorFilter, sort]);

  useEffect(() => {
    if (needle.length < 3) {
      lastTrackedSearchKeyRef.current = "";
      return;
    }

    const key = JSON.stringify({
      needle,
      storageFilter,
      colorFilter,
      sort,
    });

    if (lastTrackedSearchKeyRef.current === key) {
      return;
    }

    lastTrackedSearchKeyRef.current = key;
    trackStorefrontSearch(deferredQuery, {
      results_count: filteredProducts.length,
      storage_filter: storageFilter === "all" ? undefined : storageFilter,
      sort,
    });
  }, [colorFilter, deferredQuery, filteredProducts.length, needle, sort, storageFilter]);

  const showFeatured = needle.length === 0 && page === 1 && featuredProduct;
  const gridProducts = useMemo(() => {
    if (!showFeatured) {
      return filteredProducts;
    }
    return filteredProducts.filter((product) => product.id !== showFeatured.id);
  }, [filteredProducts, showFeatured]);

  const totalPages = Math.max(1, Math.ceil(gridProducts.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedProducts = gridProducts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const heroHeadline = showFeatured ? splitAppleHeadline(showFeatured.model || showFeatured.title) : [];
  const heroSpec = showFeatured ? buildAppleSpecLine(showFeatured) : "";

  return (
    <div className="apple-storefront">
      <header className="apple-storefront-nav">
        <Link href="/iphone" className="apple-storefront-brand">
          <Image src="/brand/logo-negro-salta.png" alt="TechnoStore" width={108} height={28} priority />
          <span className="apple-storefront-brand-copy">
            <strong>TechnoStore Apple</strong>
            <small>Colección iPhone</small>
          </span>
        </Link>

        <div className="apple-storefront-nav-links">
          <a href="#modelos" className="apple-storefront-link">
            Modelos
          </a>
          <a href="#filtros" className="apple-storefront-link">
            Filtros
          </a>
          {store.whatsapp_url ? (
            <a className="apple-storefront-cta" href={store.whatsapp_url} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          ) : null}
        </div>
      </header>

      {showFeatured ? (
        <section className="apple-storefront-hero">
          <article className="apple-feature-card">
            <Link href={buildAppleProductPath(showFeatured.sku)} className="apple-feature-link-surface apple-feature-copy">
              <AppleTierPill />
              <div className="apple-feature-headline">
                {heroHeadline.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
              {heroSpec ? <p className="apple-feature-spec">{heroSpec}</p> : null}
            </Link>

            <Link href={buildAppleProductPath(showFeatured.sku)} className="apple-feature-link-surface apple-feature-visual" aria-label={`Ver ${showFeatured.title}`}>
              <ProductImage product={showFeatured} eager />
            </Link>

            <div className="apple-feature-footer">
              <div className="apple-feature-price">
                <span>Precio</span>
                <strong>{formatMoney(showFeatured.public_price_ars)}</strong>
              </div>
              <div className="apple-feature-actions">
                <AppleWhatsAppButton product={showFeatured} whatsappUrl={store.whatsapp_url} sourcePath="/iphone" />
              </div>
              <span className="apple-support-pill apple-feature-support">{APPLE_SUPPORT_COPY}</span>
            </div>
          </article>
        </section>
      ) : null}

      <section className="apple-filters" id="filtros">
        <label className="apple-filter-field apple-filter-search">
          <span>Buscar equipo</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="iPhone 17 Pro Max, 256GB, Blanco..."
          />
        </label>

        <label className="apple-filter-field">
          <span>Memoria</span>
          <select value={storageFilter} onChange={(event) => setStorageFilter(event.target.value)}>
            <option value="all">Todas</option>
            {storageOptions.map((value) => (
              <option key={value} value={String(value)}>
                {value}GB
              </option>
            ))}
          </select>
        </label>

        <label className="apple-filter-field">
          <span>Color</span>
          <select value={colorFilter} onChange={(event) => setColorFilter(event.target.value)}>
            <option value="all">Todos</option>
            {colorOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="apple-filter-field">
          <span>Orden</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="premium">Premium primero</option>
            <option value="price-asc">Precio menor</option>
            <option value="alphabetical">A-Z</option>
          </select>
        </label>
      </section>

      <section className="apple-catalog-shell" id="modelos">
        <div className="apple-catalog-heading">
          <div>
            <h2>Colección iPhone</h2>
            <p>{gridProducts.length} modelos visibles con la estética Apple dedicada.</p>
          </div>
          <span className="apple-catalog-count">{filteredProducts.length} resultados</span>
        </div>

        {pagedProducts.length === 0 ? (
          <div className="apple-empty-state">
            <h3>No encontramos equipos con esos filtros.</h3>
            <p>Probá quitando el color o la memoria para volver a abrir el catálogo.</p>
          </div>
        ) : (
          <div className="apple-card-grid">
            {pagedProducts.map((product) => {
              const headline = splitAppleHeadline(product.model || product.title);
              const specLine = buildAppleSpecLine(product);
              const detailHref = buildAppleProductPath(product.sku);

              return (
                <article key={product.id} className="apple-product-card">
                  <Link href={detailHref} className="apple-card-link-surface apple-card-copy">
                    <AppleTierPill />
                    <div className="apple-card-headline">
                      {headline.map((line) => (
                        <span key={line}>{line}</span>
                      ))}
                    </div>
                    {specLine ? <p className="apple-card-spec">{specLine}</p> : null}
                  </Link>

                  <Link href={detailHref} className="apple-card-link-surface apple-card-visual" aria-label={`Ver ${product.title}`}>
                    <ProductImage product={product} />
                  </Link>

                  <div className="apple-card-bottom">
                    <div className="apple-card-price">
                      <span>Precio</span>
                      <strong>{formatMoney(product.public_price_ars)}</strong>
                    </div>
                    <div className="apple-card-actions">
                      <AppleWhatsAppButton product={product} whatsappUrl={store.whatsapp_url} sourcePath="/iphone" />
                    </div>
                    <span className="apple-support-pill apple-card-support">{APPLE_SUPPORT_COPY}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {totalPages > 1 ? (
          <div className="apple-pagination">
            <button type="button" className="apple-page-button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1}>
              Anterior
            </button>
            <span className="apple-page-indicator">
              Página {currentPage} de {totalPages}
            </span>
            <button
              type="button"
              className="apple-page-button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={currentPage === totalPages}
            >
              Siguiente
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
