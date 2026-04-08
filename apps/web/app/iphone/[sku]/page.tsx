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
  const installmentOffer = buildStorefrontInstallmentOffer(product);
  const parts = ["Envíos a todo el país", "Seguimiento por WhatsApp"];
  if (installmentOffer) {
    parts.push(`${installmentOffer.installments} cuotas claras`);
  }

  return parts.join(" · ");
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
  const trustPoints = product
    ? [
        {
          title: "Compra con respaldo",
          copy: "Precio final claro, atención humana y acompañamiento por WhatsApp antes y después de pagar.",
        },
        {
          title: "Envío o retiro",
          copy: product.in_stock
            ? "Podés coordinar envío nacional o retiro en Salta con stock listo para salir rápido."
            : buildShippingSummary(product),
        },
        {
          title: "Cuotas visibles",
          copy:
            financingOptions.length > 0
              ? "Te mostramos el valor por cuota y el total financiado para que compares sin sorpresas."
              : "Si querés financiación, te confirmamos la alternativa disponible antes de avanzar.",
        },
      ]
    : [];
  const buyingSteps = [
    "Elegís el iPhone y nos decís si lo querés con envío o retiro.",
    "Te confirmamos stock, precio final y la opción de pago que más te conviene.",
    "Pagás y coordinamos despacho, retiro o ingreso desde proveedor.",
  ];
  const faqs = product
    ? [
        {
          question: "¿Hacen envíos a todo el país?",
          answer: "Sí. Coordinamos el envío y el seguimiento por WhatsApp para que tengas visibilidad durante toda la compra.",
        },
        {
          question: "¿Qué pasa si no está en stock hoy?",
          answer: buildShippingSummary(product),
        },
        {
          question: "¿Puedo comprar en cuotas?",
          answer:
            financingOptions.length > 0
              ? "Sí. En esta ficha ya ves las opciones de cuotas disponibles con el valor por cuota y el total financiado."
              : "Si este modelo no muestra cuotas, igual podemos revisarte alternativas por WhatsApp.",
        },
        {
          question: "¿Cómo los contacto para cerrar?",
          answer: "Podés avanzar por pago o escribirnos por WhatsApp con el equipo ya cargado para cerrar más rápido.",
        },
      ]
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
                    note="Elegí envío, urgencia y pago para que podamos atenderte más rápido."
                    className="apple-detail-actions"
                    intentCaptureMode="full"
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
                  note="Elegí envío, urgencia y pago para que podamos atenderte más rápido."
                  className="apple-detail-actions apple-detail-actions--footer"
                  intentCaptureMode="full"
                  sourcePlacement="apple_detail_footer"
                />
              </div>
            </section>

            <section className="apple-info-grid">
              <article className="apple-info-card">
                <span className="apple-info-kicker">Confianza para comprar</span>
                <h2 className="apple-info-title">Un iPhone premium merece una compra clara.</h2>
                <div className="apple-info-list">
                  {trustPoints.map((item) => (
                    <div key={item.title} className="apple-info-row">
                      <strong>{item.title}</strong>
                      <p>{item.copy}</p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="apple-info-card">
                <span className="apple-info-kicker">Opciones de pago</span>
                <h2 className="apple-info-title">Compará contado y cuotas sin adivinar números.</h2>
                {financingOptions.length > 0 ? (
                  <div className="apple-payment-options">
                    {financingOptions.map((option) => (
                      <div key={option.provider} className="apple-payment-option">
                        <div className="apple-payment-head">
                          <strong>{option.provider === "macro" ? "Plan Macro" : "Bancarizada"}</strong>
                          <span>{option.installments} cuotas</span>
                        </div>
                        <p className="apple-payment-amount">
                          {option.installments} x {formatMoney(option.installmentAmount)}
                        </p>
                        <p className="apple-payment-total">
                          Total financiado: {option.totalAmount != null ? formatMoney(option.totalAmount) : "A confirmar"}
                        </p>
                        {option.interest != null ? (
                          <small className="apple-payment-interest">Interés estimado: {option.interest.toFixed(1)}%</small>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="apple-info-copy">
                    Este modelo no tiene una financiación cargada en este momento, pero igual podemos revisarte alternativas por
                    WhatsApp.
                  </p>
                )}
              </article>

              <article className="apple-info-card">
                <span className="apple-info-kicker">Cómo se compra</span>
                <h2 className="apple-info-title">Un proceso simple para cerrar sin fricción.</h2>
                <div className="apple-step-list">
                  {buyingSteps.map((step, index) => (
                    <div key={step} className="apple-step">
                      <span>{index + 1}</span>
                      <p>{step}</p>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="apple-faq-grid">
              {faqs.map((item) => (
                <details key={item.question} className="apple-faq-card">
                  <summary className="apple-faq-question">{item.question}</summary>
                  <p className="apple-faq-answer">{item.answer}</p>
                </details>
              ))}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
