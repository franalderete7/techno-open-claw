import type { Metadata } from "next";
import { buildStorefrontProductUrl, type StorefrontProduct } from "./storefront";

const DEFAULT_STOREFRONT_URL = "https://technostoresalta.com";
const DEFAULT_SOCIAL_IMAGE_PATH = "/brand/logo-negro-salta.png";

function normalizeStorefrontUrl(storefrontUrl: string | null | undefined) {
  const raw = storefrontUrl?.trim() || DEFAULT_STOREFRONT_URL;

  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_STOREFRONT_URL;
  }
}

function resolveAssetUrl(storefrontUrl: string, assetUrl: string | null | undefined) {
  const raw = assetUrl?.trim();
  if (!raw) {
    return new URL(DEFAULT_SOCIAL_IMAGE_PATH, storefrontUrl).toString();
  }

  try {
    return new URL(raw, storefrontUrl).toString();
  } catch {
    return new URL(DEFAULT_SOCIAL_IMAGE_PATH, storefrontUrl).toString();
  }
}

function formatMoney(amount: number | null) {
  if (amount == null) {
    return "Precio a confirmar";
  }

  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function buildAvailabilityLabel(product: StorefrontProduct) {
  if (product.in_stock) {
    return "Disponible";
  }

  if (product.delivery_days && product.delivery_days > 0) {
    return `Entrega estimada en ${product.delivery_days} días`;
  }

  return "Consultar disponibilidad";
}

function buildProductDescription(product: StorefrontProduct, storeName: string) {
  const parts = [
    product.description?.trim() || null,
    [product.color, product.storage_gb ? `${product.storage_gb}GB` : null, product.network].filter(Boolean).join(" · ") || null,
    formatMoney(product.public_price_ars),
    buildAvailabilityLabel(product),
    `Consultá por WhatsApp en ${storeName}.`,
  ].filter(Boolean);

  return parts.join(" ").slice(0, 260);
}

export function buildStorefrontPageMetadata(params: {
  title: string;
  description: string;
  path: string;
  storefrontUrl?: string | null;
  siteName?: string;
  imageUrl?: string | null;
}): Metadata {
  const storefrontUrl = normalizeStorefrontUrl(params.storefrontUrl);
  const canonical = new URL(params.path, storefrontUrl).toString();
  const imageUrl = resolveAssetUrl(storefrontUrl, params.imageUrl);
  const siteName = params.siteName?.trim() || "TechnoStore Salta";

  return {
    title: params.title,
    description: params.description,
    alternates: {
      canonical,
    },
    openGraph: {
      type: "website",
      url: canonical,
      title: params.title,
      description: params.description,
      siteName,
      images: [
        {
          url: imageUrl,
          alt: params.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: params.title,
      description: params.description,
      images: [imageUrl],
    },
  };
}

export function buildStorefrontProductMetadata(params: {
  product: StorefrontProduct;
  path: string;
  storefrontUrl?: string | null;
  storeName: string;
}): Metadata {
  const storefrontUrl = normalizeStorefrontUrl(params.storefrontUrl);
  const canonical = buildStorefrontProductUrl(storefrontUrl, params.product.sku) || new URL(params.path, storefrontUrl).toString();
  const imageUrl = resolveAssetUrl(storefrontUrl, params.product.image_url);
  const description = buildProductDescription(params.product, params.storeName);

  return {
    title: `${params.product.title} | ${params.storeName}`,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      type: "website",
      url: canonical,
      title: params.product.title,
      description,
      siteName: params.storeName,
      images: [
        {
          url: imageUrl,
          alt: params.product.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: params.product.title,
      description,
      images: [imageUrl],
    },
  };
}
