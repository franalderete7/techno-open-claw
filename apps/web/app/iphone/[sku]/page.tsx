import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProducts, getSettings } from "../../../lib/api";
import { getSiteMode } from "../../../lib/site-mode";
import { buildStorefrontProducts, buildStorefrontProfile, type StorefrontProduct } from "../../../lib/storefront";
import { MetaProductViewTracker } from "../../components/meta-product-view-tracker";
import { StorefrontProductActions } from "../../components/storefront-product-actions";

const APPLE_SUPPORT_COPY = "Garantía de 1 año · Envío nacional · 6 cuotas";

type AppleProductPageProps = {
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

function normalizeSku(value: string) {
  return decodeURIComponent(value).trim().toLowerCase();
}

function buildAppleProductPath(sku: string) {
  return `/iphone/${encodeURIComponent(sku.trim().toLowerCase())}`;
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

function ProductMedia({ product }: { product: StorefrontProduct }) {
  const initials = product.brand.slice(0, 2).toUpperCase();

  if (!product.image_url) {
    return (
      <div className="apple-phone-fallback apple-phone-fallback--detail">
        <span className="apple-phone-fallback-mark">{initials}</span>
        <span className="apple-phone-fallback-copy">Imagen a confirmar</span>
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
      className="apple-phone-image apple-phone-image--detail"
    />
  );
}

export default async function AppleProductPage({ params }: AppleProductPageProps) {
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
    const [productResponse, settingsResponse] = await Promise.all([getProducts(200, { active: true }), getSettings()]);
    products = productResponse.items;
    settings = settingsResponse.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load Apple storefront";
  }

  const store = { ...buildStorefrontProfile(settings), name: "TechnoStore Apple" };
  const appleProducts = buildStorefrontProducts(products).filter(
    (product) => product.brand.trim().toLowerCase() === "apple" && product.condition.toLowerCase() === "new"
  );
  const product = appleProducts.find((item) => item.sku.trim().toLowerCase() === requestedSku) ?? null;

  if (!product && !error) {
    notFound();
  }

  const headline = product ? splitAppleHeadline(product.model || product.title) : [];
  const specLine = product ? buildAppleSpecLine(product) : "";
  const detailHref = product ? buildAppleProductPath(product.sku) : "/iphone";
  const specChips = product
    ? [product.ram_gb ? `${product.ram_gb}GB RAM` : null, product.storage_gb ? `${product.storage_gb}GB` : null, product.network, product.color]
        .filter(Boolean)
        .map((value) => String(value))
    : [];

  return (
    <div className="apple-storefront apple-storefront--detail">
      <header className="apple-storefront-nav">
        <Link href="/iphone" className="apple-storefront-brand" aria-label="Inicio iPhone">
          <Image src="/brand/logo-blanco-salta.png" alt="" width={108} height={28} priority />
        </Link>

        <div className="apple-storefront-nav-links">
          <Link href="/iphone" className="apple-storefront-link">
            Volver a la tienda Apple
          </Link>
          {store.whatsapp_url ? (
            <a className="apple-storefront-cta" href={store.whatsapp_url} target="_blank" rel="noreferrer">
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
        <>
          <MetaProductViewTracker
            productId={product.id}
            sku={product.sku}
            title={product.title}
            brand={product.brand}
            value={product.public_price_ars}
            currency="ARS"
          />

          <div className="apple-detail-shell">
            <div className="apple-detail-breadcrumbs">
              <Link href="/iphone" className="apple-back-link">
                Volver a iPhone
              </Link>
              <span className="apple-sku-chip">{product.sku}</span>
              <span className={`apple-stock-chip ${product.in_stock ? "is-live" : "is-muted"}`}>
                {product.in_stock ? "Disponible" : "Consultar disponibilidad"}
              </span>
            </div>

            <section className="apple-detail-stage">
              <div className="apple-detail-copy">
                <span className="apple-tier-pill">APPLE PREMIUM</span>
                <div className="apple-detail-headline">
                  {headline.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
                {specLine ? <p className="apple-detail-spec">{specLine}</p> : null}
                {product.description ? <p className="apple-detail-description">{product.description}</p> : null}
                {specChips.length > 0 ? (
                  <div className="apple-detail-chip-row">
                    {specChips.map((chip) => (
                      <span key={chip} className="apple-detail-chip">
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="apple-detail-visual">
                <ProductMedia product={product} />
              </div>

              <div className="apple-detail-footer">
                <div className="apple-detail-support">
                  <span className="apple-support-pill">{APPLE_SUPPORT_COPY}</span>
                </div>

                <div className="apple-detail-price-block">
                  <span>Precio</span>
                  <strong>{formatMoney(product.public_price_ars)}</strong>
                  <small>
                    {product.delivery_days ? `Entrega estimada en ${product.delivery_days} días` : "Retiro o entrega coordinada"}
                  </small>
                </div>

                <StorefrontProductActions
                  product={product}
                  whatsappUrl={store.whatsapp_url}
                  sourcePath={detailHref}
                  note={null}
                  className="apple-detail-actions"
                />
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
