import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getProducts, getSettings } from "../../../lib/api";
import { getSiteMode } from "../../../lib/site-mode";
import { buildStorefrontPageMetadata, buildStorefrontProductMetadata } from "../../../lib/storefront-metadata";
import {
  buildStorefrontInstallmentOffer,
  buildStorefrontProducts,
  buildStorefrontProfile,
  type StorefrontProduct,
} from "../../../lib/storefront";
import { AppleAnnouncementBar } from "../../components/apple-announcement-bar";
import { ApplePurchaseProcess } from "../../components/apple-purchase-process";
import { AppleStorefrontFooter } from "../../components/apple-storefront-footer";
import { MetaProductViewTracker } from "../../components/meta-product-view-tracker";
import { StorefrontProductActions } from "../../components/storefront-product-actions";

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

function formatPercent(amount: number | null) {
  if (amount == null || !Number.isFinite(amount)) {
    return null;
  }

  return `${amount.toFixed(1)}%`;
}

function normalizeSku(value: string) {
  return decodeURIComponent(value).trim().toLowerCase();
}

function buildAppleProductPath(sku: string) {
  return `/iphone/${encodeURIComponent(sku.trim().toLowerCase())}`;
}

function buildAppleSpecLine(product: StorefrontProduct) {
  return [product.color, product.storage_gb ? `${product.storage_gb}GB` : null].filter(Boolean).join(" · ");
}

function buildAppleSupportCopy(product: StorefrontProduct) {
  return "Envíos a todo el país · Seguimiento por WhatsApp";
}

type AppleFinancingOption = {
  provider: "bancarizada" | "macro";
  installments: number;
  installmentAmount: number;
  totalAmount: number | null;
  interest: number | null;
};

function buildFinancingOptions(product: StorefrontProduct): AppleFinancingOption[] {
  const installments = Math.round(product.cuotas_qty ?? 0);
  if (!Number.isFinite(installments) || installments < 2) {
    return [];
  }

  const options: AppleFinancingOption[] = [];
  if (product.bancarizada_cuota != null && product.bancarizada_cuota > 0) {
    options.push({
      provider: "bancarizada",
      installments,
      installmentAmount: product.bancarizada_cuota,
      totalAmount: product.bancarizada_total ?? null,
      interest: product.bancarizada_interest ?? null,
    });
  }

  if (product.macro_cuota != null && product.macro_cuota > 0) {
    options.push({
      provider: "macro",
      installments,
      installmentAmount: product.macro_cuota,
      totalAmount: product.macro_total ?? null,
      interest: product.macro_interest ?? null,
    });
  }

  return options.sort((left, right) => left.installmentAmount - right.installmentAmount);
}

function buildShippingSummary(product: StorefrontProduct) {
  if (product.in_stock) {
    return "Si está en stock, coordinamos salida rápida y seguimiento por WhatsApp.";
  }

  if (product.delivery_days && product.delivery_days > 0) {
    return `Si entra por proveedor, la entrega estimada es de ${product.delivery_days} días y te acompañamos en todo el proceso.`;
  }

  return "Confirmamos disponibilidad y tiempos antes de avanzar para que compres con tranquilidad.";
}

const loadAppleProductPageData = cache(async (requestedSku: string) => {
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

  return {
    error,
    store,
    product,
  };
});

export async function generateMetadata({ params }: AppleProductPageProps): Promise<Metadata> {
  if ((await getSiteMode()) !== "storefront") {
    return {};
  }

  const { sku: rawSku } = await params;
  const requestedSku = normalizeSku(rawSku);
  if (!requestedSku) {
    return {};
  }

  const { store, product } = await loadAppleProductPageData(requestedSku);
  if (!product) {
    return buildStorefrontPageMetadata({
      title: "iPhone | TechnoStore Apple",
      description: "Catálogo de iPhone nuevos con precio final, cuotas visibles, envíos a todo el país y atención real por WhatsApp.",
      path: "/iphone",
      storefrontUrl: store.storefront_url,
      siteName: "TechnoStore Apple",
      imageUrl: "/brand/logo-blanco-salta.png",
    });
  }

  return buildStorefrontProductMetadata({
    product,
    path: buildAppleProductPath(product.sku),
    storefrontUrl: store.storefront_url,
    storeName: store.name,
  });
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

  const { error, store, product } = await loadAppleProductPageData(requestedSku);

  if (!product && !error) {
    notFound();
  }

  const titleLine = product ? (product.model || product.title).trim() : "";
  const specLine = product ? buildAppleSpecLine(product) : "";
  const detailHref = product ? buildAppleProductPath(product.sku) : "/iphone";
  const installmentOffer = product ? buildStorefrontInstallmentOffer(product) : null;
  const financingOptions = product ? buildFinancingOptions(product) : [];
  const specChips = product
    ? [product.ram_gb ? `${product.ram_gb}GB RAM` : null, product.storage_gb ? `${product.storage_gb}GB` : null, product.network, product.color]
        .filter(Boolean)
        .map((value) => String(value))
    : [];
  const announcementItems = [
    "Envíos a todo el país con seguimiento por WhatsApp",
    product?.in_stock ? "Stock listo para coordinar entrega rápida" : "Te confirmamos ingreso y tiempos antes de avanzar",
    financingOptions.length > 0 ? "Cuotas visibles y total financiado claro" : "Precio final claro antes de cerrar la compra",
  ];
  return (
    <div className="apple-storefront apple-storefront--detail">
      <AppleAnnouncementBar items={announcementItems} />
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
                  <span>{titleLine}</span>
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
                <div className="apple-detail-mobile-cta">
                  <StorefrontProductActions
                    product={product}
                    whatsappUrl={store.whatsapp_url}
                    sourcePath={detailHref}
                    note={null}
                    className="apple-detail-actions"
                    sourcePlacement="apple_detail_mobile"
                  />
                </div>
              </div>

              <div className="apple-detail-visual">
                <ProductMedia product={product} />
              </div>

              <div className="apple-detail-footer">
                <div className="apple-detail-support">
                  <span className="apple-support-pill">{buildAppleSupportCopy(product)}</span>
                </div>

                <div className="apple-detail-price-block">
                  <span>Precio</span>
                  <strong>{formatMoney(product.public_price_ars)}</strong>
                  {installmentOffer ? (
                    <small className="apple-installment-copy">
                      o en {installmentOffer.installments} cuotas de {formatMoney(installmentOffer.installmentAmount)}
                    </small>
                  ) : null}
                  <small>
                    {product.delivery_days ? `Entrega estimada en ${product.delivery_days} días` : "Retiro o entrega coordinada"}
                  </small>
                </div>

                <StorefrontProductActions
                  product={product}
                  whatsappUrl={store.whatsapp_url}
                  sourcePath={detailHref}
                  note={null}
                  className="apple-detail-actions apple-detail-actions--footer"
                  sourcePlacement="apple_detail_footer"
                />
              </div>
            </section>

            <ApplePurchaseProcess variant="detail" inStock={product.in_stock} deliveryDays={product.delivery_days ?? null} />

            <AppleStorefrontFooter
              sections={[
                {
                  title: "Envío y retiro",
                  body: product.in_stock
                    ? "Si el equipo está en stock, coordinamos envío nacional o retiro en Salta con salida rápida."
                    : buildShippingSummary(product),
                },
                {
                  title: "Cuotas y pago",
                  body:
                    financingOptions.length > 0
                      ? financingOptions
                          .map((option) => {
                            const provider = option.provider === "macro" ? "Macro" : "bancarizada";
                            const interest = formatPercent(option.interest);
                            return `${option.installments} x ${formatMoney(option.installmentAmount)} con ${provider}${interest ? ` · interés estimado ${interest}` : ""}`;
                          })
                          .join(" | ")
                      : "Si este modelo no muestra cuotas cargadas, te confirmamos alternativas por WhatsApp antes de avanzar.",
                },
                {
                  title: "Atención y garantía",
                  body: "Te acompañamos por WhatsApp durante la compra y coordinamos la entrega con información clara en cada paso.",
                },
              ]}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
