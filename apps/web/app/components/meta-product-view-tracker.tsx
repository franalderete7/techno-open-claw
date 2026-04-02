"use client";

import { useEffect } from "react";
import { trackMetaViewContent } from "../../lib/meta-pixel";
import { trackStorefrontEvent } from "../../lib/storefront-analytics";

type MetaProductViewTrackerProps = {
  productId?: number | null;
  sku: string;
  title: string;
  brand: string;
  value: number | null;
  currency?: string;
};

export function MetaProductViewTracker({ productId, sku, title, brand, value, currency = "ARS" }: MetaProductViewTrackerProps) {
  useEffect(() => {
    trackMetaViewContent({
      sku,
      title,
      brand,
      value,
      currency,
    });
    trackStorefrontEvent("view_content", {
      product_id: productId ?? null,
      sku,
      value_amount: value,
      currency_code: currency,
      payload: {
        title,
        brand,
      },
    });
  }, [brand, currency, productId, sku, title, value]);

  return null;
}
