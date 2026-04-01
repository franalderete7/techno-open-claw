"use client";

import Link from "next/link";
import { useState } from "react";
import { trackMetaContact, trackMetaInitiateCheckout } from "../../lib/meta-pixel";
import { buildStorefrontConsultUrl, buildStorefrontPaymentFallbackUrl, type StorefrontProduct } from "../../lib/storefront";

type StorefrontProductActionsProps = {
  product: Pick<StorefrontProduct, "id" | "sku" | "title" | "brand" | "public_price_ars">;
  whatsappUrl: string | null;
  sourcePath?: string | null;
  note?: string | null;
  className?: string;
  detailHref?: string | null;
  detailLabel?: string;
};

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
}: StorefrontProductActionsProps) {
  const [pending, setPending] = useState(false);
  const consultUrl = buildStorefrontConsultUrl(whatsappUrl, product);
  const fallbackUrl = buildStorefrontPaymentFallbackUrl(whatsappUrl, product);
  const payEnabled = product.public_price_ars != null;

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

      const response = await fetch("/api/storefront/payment-intents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product_id: product.id,
          source_path: sourcePath || (typeof window !== "undefined" ? window.location.pathname : null),
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
          {pending ? "Preparando..." : "Quiero pagarlo ahora"}
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
            onClick={() =>
              trackMetaContact({
                sku: product.sku,
                title: product.title,
                brand: product.brand,
                value: product.public_price_ars,
                currency: "ARS",
              })
            }
            data-fast-goal="click_consultar"
            data-fast-goal-product-id={String(product.id)}
            data-fast-goal-product-sku={product.sku}
            data-fast-goal-product-title={product.title}
            data-fast-goal-price-ars={product.public_price_ars != null ? String(product.public_price_ars) : undefined}
            data-fast-goal-source-path={sourcePath ?? undefined}
          >
            <WhatsAppIcon />
            Consultar
          </a>
        ) : null}
      </div>
      {note ? <p className="storefront-card-action-note">{note}</p> : null}
    </>
  );
}
