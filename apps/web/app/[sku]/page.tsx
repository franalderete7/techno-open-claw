import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProducts, getSettings } from "../../lib/api";
import { getSiteMode } from "../../lib/site-mode";
import {
  buildStorefrontProductPath,
  buildStorefrontProductUrl,
  buildStorefrontProducts,
  buildStorefrontProfile,
  type StorefrontProduct,
} from "../../lib/storefront";
import { StorefrontProductActions } from "../components/storefront-product-actions";

type StorefrontProductPageProps = {
  params: Promise<{
    sku: string;
  }>;
};

function formatMoney(amount: number | null) {
  if (amount == null) return "Consultar";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function buildSpecSummary(product: StorefrontProduct) {
  return [
    product.ram_gb ? `${product.ram_gb}GB RAM` : null,
    product.storage_gb ? `${product.storage_gb}GB` : null,
    product.network ? product.network.toUpperCase() : null,
    product.color,
    product.condition && product.condition.toLowerCase() !== "new" ? product.condition : null,
  ].filter(Boolean);
}

function normalizeSku(value: string) {
  return decodeURIComponent(value).trim().toLowerCase();
}

function ProductMedia({ product }: { product: StorefrontProduct }) {
  const initials = product.brand.slice(0, 2).toUpperCase();

  if (!product.image_url) {
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
      loading="eager"
      decoding="async"
      referrerPolicy="no-referrer"
      className="storefront-product-image"
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

export default async function StorefrontProductPage({ params }: StorefrontProductPageProps) {
  if ((await getSiteMode()) !== "storefront") {
    notFound();
  }

  const { sku: rawSku } = await params;
  const requestedSku = normalizeSku(rawSku);

  if (!requestedSku) {
    notFound();
  }

  let products = [] as Awaited<ReturnType<typeof getProducts>>["items"];
  let settings = [] as Awaited<ReturnType<typeof getSettings>>["items"];
  let error: string | null = null;

  try {
    const [productResponse, settingsResponse] = await Promise.all([getProducts(120, { active: true }), getSettings()]);
    products = productResponse.items;
    settings = settingsResponse.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load storefront";
  }

  const store = buildStorefrontProfile(settings);
  const storefrontProducts = buildStorefrontProducts(products);
  const product = storefrontProducts.find((item) => item.sku.trim().toLowerCase() === requestedSku) ?? null;

  if (!product && !error) {
    notFound();
  }

  const specSummary = product ? buildSpecSummary(product) : [];
  const detailHref = product ? buildStorefrontProductPath(product.sku) : "/";
  const productUrl = product ? buildStorefrontProductUrl(store.storefront_url, product.sku) : store.storefront_url || "/";

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

          {store.whatsapp_url ? (
            <a className="storefront-navbar-cta" href={store.whatsapp_url} target="_blank" rel="noreferrer">
              <WhatsAppIcon />
              WhatsApp
            </a>
          ) : null}
        </div>
      </header>

      {error ? (
        <section className="panel">
          <p className="empty">{error}</p>
        </section>
      ) : product ? (
        <section className="storefront-product-page">
          <div className="storefront-product-breadcrumbs">
            <Link href="/" className="chip action-link">
              Volver al catalogo
            </Link>
            <span className="chip accent mono">{product.sku}</span>
            <span className={`chip ${product.in_stock ? "good" : "warn"}`}>
              {product.in_stock ? "Disponible" : "Consultar disponibilidad"}
            </span>
          </div>

          <article className="storefront-product-detail">
            <div className="storefront-product-visual">
              <ProductMedia product={product} />
            </div>

            <div className="storefront-product-content">
              <div className="storefront-product-heading">
                <p className="catalog-kicker">{product.brand}</p>
                <h1 className="storefront-title storefront-product-title">{product.title}</h1>
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

              {product.description ? <p className="storefront-product-description">{product.description}</p> : null}

              <div className="storefront-product-price-card">
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
                sourcePath={detailHref}
                note="Abrimos WhatsApp con este modelo ya cargado o te llevamos directo al pago."
              />

              <div className="storefront-product-share">
                <p className="storefront-price-label">Link de este equipo</p>
                <a className="storefront-inline-link" href={productUrl}>
                  {productUrl}
                </a>
              </div>
            </div>
          </article>
        </section>
      ) : null}
    </div>
  );
}
