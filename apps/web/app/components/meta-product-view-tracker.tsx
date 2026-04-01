"use client";

import { useEffect } from "react";
import { trackMetaViewContent } from "../../lib/meta-pixel";

type MetaProductViewTrackerProps = {
  sku: string;
  title: string;
  brand: string;
  value: number | null;
  currency?: string;
};

export function MetaProductViewTracker({ sku, title, brand, value, currency = "ARS" }: MetaProductViewTrackerProps) {
  useEffect(() => {
    trackMetaViewContent({
      sku,
      title,
      brand,
      value,
      currency,
    });
  }, [brand, currency, sku, title, value]);

  return null;
}
