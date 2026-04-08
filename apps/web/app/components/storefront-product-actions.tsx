"use client";

import Link from "next/link";
import { useState } from "react";
import { trackMetaContact, trackMetaInitiateCheckout } from "../../lib/meta-pixel";
import { getStorefrontAnalyticsContext, trackStorefrontEvent } from "../../lib/storefront-analytics";
import {
  buildStorefrontConsultUrl,
  buildStorefrontPaymentFallbackUrl,
  type StorefrontBuyerIntent,
  type StorefrontProduct,
} from "../../lib/storefront";

type StorefrontProductActionsProps = {
  product: Pick<StorefrontProduct, "id" | "sku" | "title" | "brand" | "public_price_ars">;
  whatsappUrl: string | null;
  sourcePath?: string | null;
  note?: string | null;
  className?: string;
  detailHref?: string | null;
  detailLabel?: string;
  intentCaptureMode?: "none" | "compact" | "full";
  sourcePlacement?: string | null;
  initialIntent?: StorefrontBuyerIntent | null;
};

function trimIntentText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

export function StorefrontProductActions({
  product,
  whatsappUrl,
  sourcePath,
  note = "Abrimos WhatsApp con este modelo ya cargado.",
  className,
  detailHref,
  detailLabel = "Ver equipo",
  intentCaptureMode = "none",
  sourcePlacement = null,
  initialIntent = null,
}: StorefrontProductActionsProps) {
  const [pending, setPending] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState<StorefrontBuyerIntent["delivery_mode"]>(initialIntent?.delivery_mode ?? null);
  const [availabilityPreference, setAvailabilityPreference] = useState<StorefrontBuyerIntent["availability_preference"]>(
    initialIntent?.availability_preference ?? null
  );
  const [paymentPreference, setPaymentPreference] = useState<StorefrontBuyerIntent["payment_preference"]>(
    initialIntent?.payment_preference ?? null
  );
  const [customerCity, setCustomerCity] = useState(initialIntent?.customer_city ?? "");
  const [customerProvince, setCustomerProvince] = useState(initialIntent?.customer_province ?? "");
  const payEnabled = product.public_price_ars != null;

  const baseIntent: StorefrontBuyerIntent = {
    delivery_mode: deliveryMode,
    availability_preference: availabilityPreference,
    payment_preference: paymentPreference,
    customer_city: trimIntentText(customerCity),
    customer_province: trimIntentText(customerProvince),
    source_placement: sourcePlacement ?? initialIntent?.source_placement ?? null,
  };
  const consultIntent: StorefrontBuyerIntent = {
    ...baseIntent,
    contact_goal: availabilityPreference === "stock_now" ? "confirm_stock" : "advice",
  };
  const payIntent: StorefrontBuyerIntent = {
    ...baseIntent,
    contact_goal: "buy_now",
  };
  const consultUrl = buildStorefrontConsultUrl(whatsappUrl, product, consultIntent);
  const fallbackUrl = buildStorefrontPaymentFallbackUrl(whatsappUrl, product, payIntent);

  const payLabel =
    deliveryMode === "shipping_national"
      ? "Quiero envío a todo el país"
      : deliveryMode === "pickup_salta"
        ? "Quiero retirarlo en Salta"
        : "Quiero pagarlo ahora";
  const consultLabel = availabilityPreference === "stock_now" ? "Confirmar stock hoy" : "Quiero asesoramiento";
  const defaultActionNote =
    intentCaptureMode === "full"
      ? "Elegí cómo lo querés y seguimos por pago o WhatsApp con este modelo ya cargado."
      : "Abrimos WhatsApp con este modelo ya cargado.";
  const actionNote = note === null ? null : note ?? defaultActionNote;

  async function handlePayNow() {
    try {
      setPending(true);
      trackMetaInitiateCheckout({
        sku: product.sku,
        title: product.title,
        brand: product.brand,
        value: product.public_price_ars,
        currency: "ARS",
      });
      trackStorefrontEvent("initiate_checkout", {
        product_id: product.id,
        sku: product.sku,
        value_amount: product.public_price_ars,
        currency_code: "ARS",
        payload: {
          title: product.title,
          brand: product.brand,
          delivery_mode: payIntent.delivery_mode ?? null,
          availability_preference: payIntent.availability_preference ?? null,
          payment_preference: payIntent.payment_preference ?? null,
          customer_city: payIntent.customer_city ?? null,
          customer_province: payIntent.customer_province ?? null,
          contact_goal: payIntent.contact_goal ?? null,
          source_placement: payIntent.source_placement ?? null,
        },
      });
      const analytics = getStorefrontAnalyticsContext();

      const response = await fetch("/api/storefront/payment-intents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product_id: product.id,
          source_path: sourcePath || (typeof window !== "undefined" ? window.location.pathname : null),
          delivery_mode: payIntent.delivery_mode ?? null,
          availability_preference: payIntent.availability_preference ?? null,
          payment_preference: payIntent.payment_preference ?? null,
          customer_city: payIntent.customer_city ?? null,
          customer_province: payIntent.customer_province ?? null,
          contact_goal: payIntent.contact_goal ?? null,
          source_placement: payIntent.source_placement ?? null,
          visitor_id: analytics?.visitor_id ?? null,
          session_id: analytics?.session_id ?? null,
          page_url: analytics?.page_url ?? null,
          referrer: analytics?.referrer ?? null,
          utm_source: analytics?.utm_source ?? null,
          utm_medium: analytics?.utm_medium ?? null,
          utm_campaign: analytics?.utm_campaign ?? null,
          utm_term: analytics?.utm_term ?? null,
          utm_content: analytics?.utm_content ?? null,
          device_type: analytics?.device_type ?? null,
          device_family: analytics?.device_family ?? null,
          os_name: analytics?.os_name ?? null,
          browser_name: analytics?.browser_name ?? null,
          user_agent: analytics?.user_agent ?? null,
          screen_width: analytics?.screen_width ?? null,
          screen_height: analytics?.screen_height ?? null,
          viewport_width: analytics?.viewport_width ?? null,
          viewport_height: analytics?.viewport_height ?? null,
          language: analytics?.language ?? null,
        }),
      });

      const payload = (await response.json()) as { redirect_url?: string };
      if (!response.ok || !payload.redirect_url) {
        throw new Error("No pudimos preparar el link de pago.");
      }

      window.location.assign(payload.redirect_url);
    } catch {
      if (fallbackUrl) {
        window.location.assign(fallbackUrl);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {intentCaptureMode !== "none" ? (
        <div className="storefront-intent-card">
          <div className="storefront-intent-group">
            <span className="storefront-intent-label">Cómo querés recibirlo</span>
            <div className="storefront-intent-options">
              <button
                type="button"
                className={`storefront-intent-chip ${deliveryMode === "shipping_national" ? "is-active" : ""}`}
                onClick={() => setDeliveryMode(deliveryMode === "shipping_national" ? null : "shipping_national")}
              >
                Envío país
              </button>
              <button
                type="button"
                className={`storefront-intent-chip ${deliveryMode === "pickup_salta" ? "is-active" : ""}`}
                onClick={() => setDeliveryMode(deliveryMode === "pickup_salta" ? null : "pickup_salta")}
              >
                Retiro Salta
              </button>
            </div>
          </div>

          <div className="storefront-intent-group">
            <span className="storefront-intent-label">Tiempo</span>
            <div className="storefront-intent-options">
              <button
                type="button"
                className={`storefront-intent-chip ${availabilityPreference === "stock_now" ? "is-active" : ""}`}
                onClick={() => setAvailabilityPreference(availabilityPreference === "stock_now" ? null : "stock_now")}
              >
                Stock hoy
              </button>
              <button
                type="button"
                className={`storefront-intent-chip ${availabilityPreference === "can_wait" ? "is-active" : ""}`}
                onClick={() => setAvailabilityPreference(availabilityPreference === "can_wait" ? null : "can_wait")}
              >
                Puedo esperar
              </button>
            </div>
          </div>

          {intentCaptureMode === "full" ? (
            <>
              <div className="storefront-intent-group">
                <span className="storefront-intent-label">Cómo pensás pagarlo</span>
                <div className="storefront-intent-options">
                  <button
                    type="button"
                    className={`storefront-intent-chip ${paymentPreference === "contado" ? "is-active" : ""}`}
                    onClick={() => setPaymentPreference(paymentPreference === "contado" ? null : "contado")}
                  >
                    Contado
                  </button>
                  <button
                    type="button"
                    className={`storefront-intent-chip ${paymentPreference === "bancarizada" ? "is-active" : ""}`}
                    onClick={() => setPaymentPreference(paymentPreference === "bancarizada" ? null : "bancarizada")}
                  >
                    Bancarizada
                  </button>
                  <button
                    type="button"
                    className={`storefront-intent-chip ${paymentPreference === "macro" ? "is-active" : ""}`}
                    onClick={() => setPaymentPreference(paymentPreference === "macro" ? null : "macro")}
                  >
                    Macro
                  </button>
                </div>
              </div>

              <div className="storefront-intent-field-grid">
                <label className="storefront-intent-field">
                  <span>Ciudad</span>
                  <input
                    type="text"
                    value={customerCity}
                    onChange={(event) => setCustomerCity(event.target.value)}
                    placeholder="Ej. Córdoba"
                  />
                </label>
                <label className="storefront-intent-field">
                  <span>Provincia</span>
                  <input
                    type="text"
                    value={customerProvince}
                    onChange={(event) => setCustomerProvince(event.target.value)}
                    placeholder="Ej. Córdoba"
                  />
                </label>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <div className={className || "storefront-card-actions"}>
        <button
          type="button"
          className="storefront-pay-button"
          disabled={!payEnabled || pending}
          onClick={() => void handlePayNow()}
          data-fast-goal="click_pay_now"
          data-fast-goal-product-id={String(product.id)}
          data-fast-goal-product-sku={product.sku}
          data-fast-goal-product-title={product.title}
          data-fast-goal-price-ars={product.public_price_ars != null ? String(product.public_price_ars) : undefined}
          data-fast-goal-source-path={sourcePath ?? undefined}
        >
          {pending ? "Preparando..." : payLabel}
        </button>
        {detailHref ? (
          <Link className="storefront-secondary-button" href={detailHref}>
            {detailLabel}
          </Link>
        ) : null}
        {consultUrl ? (
          <a
            className="storefront-secondary-button"
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
                  delivery_mode: consultIntent.delivery_mode ?? null,
                  availability_preference: consultIntent.availability_preference ?? null,
                  payment_preference: consultIntent.payment_preference ?? null,
                  customer_city: consultIntent.customer_city ?? null,
                  customer_province: consultIntent.customer_province ?? null,
                  contact_goal: consultIntent.contact_goal ?? null,
                  source_placement: consultIntent.source_placement ?? null,
                },
              });
            }}
            data-fast-goal="click_consultar"
            data-fast-goal-product-id={String(product.id)}
            data-fast-goal-product-sku={product.sku}
            data-fast-goal-product-title={product.title}
            data-fast-goal-price-ars={product.public_price_ars != null ? String(product.public_price_ars) : undefined}
            data-fast-goal-source-path={sourcePath ?? undefined}
          >
            <WhatsAppIcon />
            {consultLabel}
          </a>
        ) : null}
      </div>
      {actionNote ? <p className="storefront-card-action-note">{actionNote}</p> : null}
    </>
  );
}
