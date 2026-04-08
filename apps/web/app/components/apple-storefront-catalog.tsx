"use client";

import Image from "next/image";
import Link from "next/link";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { trackStorefrontEvent, trackStorefrontSearch } from "../../lib/storefront-analytics";
import { buildStorefrontInstallmentOffer, type StorefrontProduct, type StorefrontProfile } from "../../lib/storefront";
import { AppleAnnouncementBar } from "./apple-announcement-bar";
import { ApplePurchaseProcess } from "./apple-purchase-process";
import { AppleStorefrontFooter } from "./apple-storefront-footer";
import { StorefrontProductActions } from "./storefront-product-actions";

type AppleStorefrontCatalogProps = {
  store: StorefrontProfile;
  products: StorefrontProduct[];
};

const PAGE_SIZE = 9;
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

function buildAppleSpecLine(product: StorefrontProduct) {
  return [product.color, product.storage_gb ? `${product.storage_gb}GB` : null].filter(Boolean).join(" · ");
}

function getAppleGeneration(product: Pick<StorefrontProduct, "model" | "title">) {
  const match = `${product.model} ${product.title}`.match(/iphone\s*(\d{2})/i);
  if (!match) {
    return null;
  }

  const generation = Number(match[1]);
  return Number.isFinite(generation) ? generation : null;
}

function buildAppleSupportCopy(product: StorefrontProduct) {
  return "Envíos a todo el país · Seguimiento por WhatsApp";
}

function buildAppleSalesPitch(product: StorefrontProduct) {
  const generation = getAppleGeneration(product);

  if (generation === 13) {
    return "La entrada más inteligente al mundo iPhone: rápido, confiable y con un precio que invita a cerrar.";
  }

  if (generation === 14) {
    return "Un equilibrio muy fuerte entre cámara, batería y valor para comprar bien sin irte demasiado arriba.";
  }

  if (generation === 15) {
    return "USB-C, mejor cámara y una generación muy buscada para usar varios años con tranquilidad.";
  }

  if (generation === 16) {
    return "Nueva generación para quien quiere potencia, imagen premium y un iPhone con mucha vigencia por delante.";
  }

  if (generation === 17) {
    return "Lo más nuevo de Apple para quien quiere cerrar hoy y quedarse con lo último desde el primer día.";
  }

  if ((product.storage_gb ?? 0) >= 256) {
    return "Más memoria para fotos, video y trabajo sin estar pensando en liberar espacio a cada rato.";
  }

  return "Una opción sólida para comprar con precio final claro, buena reventa y atención directa por WhatsApp.";
}

function buildAppleMerchLabel(
  product: StorefrontProduct,
  context: {
    lowestPrice: number | null;
    highestGeneration: number | null;
    highestStorage: number | null;
  }
) {
  const generation = getAppleGeneration(product);
  if (product.public_price_ars != null && context.lowestPrice != null && product.public_price_ars === context.lowestPrice) {
    return "Entrada Apple";
  }

  if (generation != null && context.highestGeneration != null && generation === context.highestGeneration) {
    return "Lo más nuevo";
  }

  if ((product.storage_gb ?? 0) > 0 && context.highestStorage != null && product.storage_gb === context.highestStorage) {
    return "Más memoria";
  }

  if (product.in_stock) {
    return "Entrega rápida";
  }

  if (buildStorefrontInstallmentOffer(product)) {
    return "Cuotas claras";
  }

  return "Muy buscado";
}

function ProductImage({ product }: { product: StorefrontProduct }) {
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
      loading="lazy"
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
  const catalogStats = useMemo(() => {
    const pricedProducts = products.filter((product) => product.public_price_ars != null);
    const generations = products.map((product) => getAppleGeneration(product)).filter((value): value is number => value != null);
    const installmentProducts = products.filter((product) => buildStorefrontInstallmentOffer(product)).length;
    const inStockProducts = products.filter((product) => product.in_stock).length;
    const lowestPrice = pricedProducts.length > 0 ? Math.min(...pricedProducts.map((product) => product.public_price_ars ?? Number.MAX_SAFE_INTEGER)) : null;
    const highestGeneration = generations.length > 0 ? Math.max(...generations) : null;
    const highestStorage = products.reduce<number | null>((current, product) => {
      if (product.storage_gb == null) {
        return current;
      }

      return current == null ? product.storage_gb : Math.max(current, product.storage_gb);
    }, null);

    return {
      lowestPrice,
      highestGeneration,
      highestStorage,
      installmentProducts,
      inStockProducts,
      generations: [...new Set(generations)].sort((left, right) => left - right),
    };
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
      placement: "apple_catalog",
    });
  }, [colorFilter, deferredQuery, filteredProducts.length, needle, sort, storageFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedProducts = filteredProducts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const heroMeta = [
    catalogStats.lowestPrice != null ? `Desde ${formatMoney(catalogStats.lowestPrice)}` : null,
    `${products.length} modelos seleccionados`,
    `${catalogStats.inStockProducts} con stock`,
  ].filter(Boolean);
  const announcementItems = [
    "Envíos a todo el país con seguimiento por WhatsApp",
    "Retiro en Salta con coordinación simple",
    "Cuotas visibles y precio final claro antes de comprar",
  ];

  return (
    <div className="apple-storefront">
      <AppleAnnouncementBar items={announcementItems} />
      <header className="apple-storefront-nav">
        <Link href="/iphone" className="apple-storefront-brand" aria-label="Inicio iPhone">
          <Image src="/brand/logo-blanco-salta.png" alt="" width={108} height={28} priority />
        </Link>

        <div className="apple-storefront-nav-links">
          <a className="apple-storefront-link" href="#modelos">
            Ver modelos
          </a>
          {store.whatsapp_url ? (
            <a className="apple-storefront-cta" href={store.whatsapp_url} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          ) : null}
        </div>
      </header>

      <section className="apple-hero">
        <div className="apple-hero-copy">
          <span className="apple-hero-kicker">Store iPhone profesional</span>
          <h1 className="apple-hero-title">iPhone con precio final claro, cuotas visibles y compra simple.</h1>
          <p className="apple-hero-description">Atención directa por WhatsApp, retiro en Salta y envío a todo el país.</p>

          <div className="apple-hero-actions">
            <a className="apple-storefront-cta" href="#modelos">
              Explorar iPhone
            </a>
            {store.whatsapp_url ? (
              <a
                className="apple-storefront-link"
                href={store.whatsapp_url}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  trackStorefrontEvent("contact", {
                    payload: {
                      channel: "whatsapp",
                      source_placement: "apple_hero",
                      contact_goal: "advice",
                    },
                  });
                }}
              >
                Hablar con un asesor
              </a>
            ) : null}
          </div>

          <p className="apple-hero-meta">{heroMeta.join(" • ")}</p>
        </div>

        <div className="apple-hero-panel">
          <ApplePurchaseProcess variant="hero" inStock={catalogStats.inStockProducts > 0} />
        </div>
      </section>

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
        <div className="apple-catalog-intro">
          <div>
            <span className="apple-hero-kicker">Modelos listos para comparar</span>
            <h2 className="apple-catalog-title">Elegí el iPhone que mejor te cierre hoy.</h2>
            <p className="apple-catalog-copy">Compará rápido, mirá cuotas y abrí WhatsApp con el modelo ya cargado.</p>
          </div>
          <div className="apple-catalog-summary">
            <span>{filteredProducts.length} equipos con tus filtros</span>
            <span>{catalogStats.inStockProducts} listos para entrega rápida</span>
          </div>
        </div>

        {pagedProducts.length === 0 ? (
          <div className="apple-empty-state">
            <h3>No encontramos equipos con esos filtros.</h3>
            <p>Probá quitando el color o la memoria para volver a abrir el catálogo.</p>
          </div>
        ) : (
          <div className="apple-card-grid">
            {pagedProducts.map((product) => {
              const titleLine = (product.model || product.title).trim();
              const specLine = buildAppleSpecLine(product);
              const detailHref = buildAppleProductPath(product.sku);
              const installmentOffer = buildStorefrontInstallmentOffer(product);
              const merchLabel = buildAppleMerchLabel(product, {
                lowestPrice: catalogStats.lowestPrice,
                highestGeneration: catalogStats.highestGeneration,
                highestStorage: catalogStats.highestStorage,
              });

              return (
                <article key={product.id} className="apple-product-card">
                  <Link href={detailHref} className="apple-card-link-surface apple-card-copy">
                    <div className="apple-card-badges">
                      <span className="apple-merch-pill">{merchLabel}</span>
                      <AppleTierPill />
                    </div>
                    <div className="apple-card-headline">
                      <span>{titleLine}</span>
                    </div>
                    {specLine ? <p className="apple-card-spec">{specLine}</p> : null}
                    <p className="apple-card-story">{buildAppleSalesPitch(product)}</p>
                  </Link>

                  <Link href={detailHref} className="apple-card-link-surface apple-card-visual" aria-label={`Ver ${product.title}`}>
                    <ProductImage product={product} />
                  </Link>

                  <div className="apple-card-bottom">
                    <span className="apple-support-pill apple-card-support">{buildAppleSupportCopy(product)}</span>
                    <div className="apple-card-price">
                      <span>Precio</span>
                      <strong>{formatMoney(product.public_price_ars)}</strong>
                      {installmentOffer ? (
                        <small className="apple-installment-copy">
                          o en {installmentOffer.installments} cuotas de {formatMoney(installmentOffer.installmentAmount)} con{" "}
                          {installmentOffer.provider === "macro" ? "Macro" : "bancarizada"}
                        </small>
                      ) : null}
                    </div>
                    <StorefrontProductActions
                      product={product}
                      whatsappUrl={store.whatsapp_url}
                      sourcePath="/iphone"
                      note={null}
                      className="apple-card-actions storefront-card-actions"
                      sourcePlacement="apple_catalog_card"
                    />
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

      <AppleStorefrontFooter
        sections={[
          {
            title: "Envíos a todo el país",
            body: "Coordinamos despacho y seguimiento por WhatsApp para que tengas visibilidad durante todo el proceso.",
          },
          {
            title: "Retiro en Salta",
            body: "Si preferís retirar, te confirmamos reserva, horario y punto de entrega antes de que salgas.",
          },
          {
            title: "Pago y cuotas",
            body: "Mostramos precio final y, cuando corresponde, el valor por cuota y el total financiado de forma clara.",
          },
        ]}
      />
    </div>
  );
}
