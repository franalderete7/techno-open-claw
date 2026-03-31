import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { config } from "./config.js";
import { pool } from "./db.js";
import { buildMediaPublicUrl } from "./media-storage.js";
import { listOrshotStudioTemplates, renderOrshotStudioTemplate } from "./orshot.js";
import { createRunwayImageToVideoTask, createRunwayTextToImageTask, getRunwayTask } from "./runway.js";

type SqlExecutor = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export const contentEngineValues = ["manual", "orshot", "runway"] as const;
export const contentChannelValues = ["feed", "story", "whatsapp", "banner", "comparison", "trust_support", "hero", "other"] as const;
export const contentFormatValues = ["image", "video", "carousel", "card", "banner", "story", "mixed"] as const;
export const contentAssetTypeValues = [
  "product_reference",
  "store_real",
  "delivery_real",
  "review_capture",
  "generated_static",
  "generated_video",
  "generated_story",
  "generated_whatsapp",
  "generated_banner",
  "other",
] as const;
export const contentAssetSourceValues = ["upload", "catalog", "telegram", "manual", "orshot", "runway", "meta", "customer", "store"] as const;
export const contentAssetStatusValues = ["draft", "approved", "rejected", "archived"] as const;
export const contentJobStatusValues = [
  "planned",
  "queued",
  "generating",
  "generated",
  "review_required",
  "approved",
  "rejected",
  "published",
  "failed",
  "cancelled",
] as const;
export const contentPriorityValues = ["low", "medium", "high", "urgent"] as const;
export const contentReviewStatusValues = ["pending", "approved", "rejected", "needs_changes"] as const;
export const contentPublicationStatusValues = ["draft", "queued", "published", "failed", "archived"] as const;
export const contentTierValues = ["high", "medium", "low", "other"] as const;
export const contentPriorityLevelValues = ["low", "medium", "high"] as const;

export type ContentBrandKey = "samsung" | "xiaomi_family" | "iphone";
type ContentTier = (typeof contentTierValues)[number];
type ContentPriorityLevel = (typeof contentPriorityLevelValues)[number];

type StrategicRule = {
  brandKey: ContentBrandKey;
  tier: ContentTier;
  priorityLevel: ContentPriorityLevel;
  heroCandidate: boolean;
  label: string;
  keywords: string[];
  ram?: number;
  storage?: number;
};

type ProductCatalogRow = {
  id: number;
  sku: string;
  slug: string;
  brand: string;
  model: string;
  title: string;
  description: string | null;
  price_amount: string | number | null;
  currency_code: string;
  image_url: string | null;
  ram_gb: number | null;
  storage_gb: number | null;
  color: string | null;
  active: boolean;
  in_stock: boolean;
  stock_units_total: number;
  stock_units_available: number;
  promo_price_ars: string | number | null;
};

type BrandProfileRow = {
  brand_key: string;
  label: string;
  visual_direction: string | null;
  theme_json: Record<string, unknown>;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type ContentTemplateRow = {
  id: number;
  template_code: string;
  label: string;
  engine: string;
  channel: string;
  format: string;
  description: string | null;
  prompt_text: string | null;
  definition_json: Record<string, unknown>;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type ProductContentProfileRow = {
  product_id: number;
  brand_key: string;
  tier: string;
  priority_level: string;
  compare_group_key: string | null;
  hero_candidate: boolean;
  content_enabled: boolean;
  visual_mode: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type MediaAssetRow = {
  id: number;
  product_id: number | null;
  brand_key: string | null;
  asset_type: string;
  source_kind: string;
  status: string;
  title: string | null;
  storage_url: string;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  external_asset_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  sku: string | null;
  model: string | null;
  product_title: string | null;
};

type ContentJobRow = {
  id: number;
  product_id: number | null;
  brand_key: string | null;
  template_id: number | null;
  engine: string;
  channel: string;
  format: string;
  title: string;
  status: string;
  priority: string;
  requested_by: string | null;
  input_json: Record<string, unknown>;
  external_job_id: string | null;
  external_status: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  template_code: string | null;
  template_label: string | null;
  sku: string | null;
  model: string | null;
  product_title: string | null;
};

type ContentOutputRow = {
  id: number;
  job_id: number;
  asset_id: number | null;
  variant_key: string | null;
  review_status: string;
  review_notes: string | null;
  output_url: string | null;
  generation_payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  title: string | null;
  template_code: string | null;
  product_id: number | null;
  sku: string | null;
  model: string | null;
  product_title: string | null;
  asset_url: string | null;
};

type ContentPublicationRow = {
  id: number;
  output_id: number;
  channel: string;
  target_account: string | null;
  platform_post_id: string | null;
  published_url: string | null;
  status: string;
  boost_candidate: boolean;
  boosted: boolean;
  metadata: Record<string, unknown>;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  template_code: string | null;
  product_id: number | null;
  sku: string | null;
  model: string | null;
  product_title: string | null;
};

type PlannerSuggestion = {
  product_id: number;
  sku: string;
  model: string;
  title: string;
  brand_key: string;
  tier: string;
  priority_level: string;
  template_code: string;
  template_label: string;
  channel: string;
  engine: string;
  format: string;
  reason: string;
  hero_candidate: boolean;
};

const STRATEGIC_MODEL_RULES: StrategicRule[] = [
  { brandKey: "samsung", tier: "high", priorityLevel: "high", heroCandidate: true, label: "Samsung S25 Ultra 12/512", keywords: ["s25 ultra"], ram: 12, storage: 512 },
  { brandKey: "samsung", tier: "high", priorityLevel: "high", heroCandidate: true, label: "Samsung S26 Ultra 12/512", keywords: ["s26 ultra"], ram: 12, storage: 512 },
  { brandKey: "samsung", tier: "high", priorityLevel: "high", heroCandidate: true, label: "Samsung S25 FE 8/512", keywords: ["s25 fe"], ram: 8, storage: 512 },
  { brandKey: "samsung", tier: "medium", priorityLevel: "medium", heroCandidate: false, label: "Samsung A57 5G 12/256", keywords: ["a57", "5g"], ram: 12, storage: 256 },
  { brandKey: "samsung", tier: "medium", priorityLevel: "medium", heroCandidate: false, label: "Samsung A57 5G 8/256", keywords: ["a57", "5g"], ram: 8, storage: 256 },
  { brandKey: "samsung", tier: "medium", priorityLevel: "medium", heroCandidate: false, label: "Samsung A56 5G 12/256", keywords: ["a56", "5g"], ram: 12, storage: 256 },
  { brandKey: "samsung", tier: "medium", priorityLevel: "medium", heroCandidate: false, label: "Samsung A37 5G 8/256", keywords: ["a37", "5g"], ram: 8, storage: 256 },
  { brandKey: "samsung", tier: "low", priorityLevel: "low", heroCandidate: false, label: "Samsung A27 5G 8/256", keywords: ["a27", "5g"], ram: 8, storage: 256 },
  { brandKey: "samsung", tier: "low", priorityLevel: "low", heroCandidate: false, label: "Samsung A26 5G 8/256", keywords: ["a26", "5g"], ram: 8, storage: 256 },
  { brandKey: "samsung", tier: "low", priorityLevel: "low", heroCandidate: false, label: "Samsung A17 6/128", keywords: ["a17"], ram: 6, storage: 128 },
  { brandKey: "samsung", tier: "low", priorityLevel: "low", heroCandidate: false, label: "Samsung A07 4/128", keywords: ["a07"], ram: 4, storage: 128 },
  { brandKey: "xiaomi_family", tier: "high", priorityLevel: "high", heroCandidate: true, label: "Xiaomi 15 Ultra 12/512", keywords: ["xiaomi 15 ultra", "15 ultra"], ram: 12, storage: 512 },
  { brandKey: "xiaomi_family", tier: "high", priorityLevel: "high", heroCandidate: true, label: "Poco F7 Ultra 12/512", keywords: ["poco f7 ultra", "f7 ultra"], ram: 12, storage: 512 },
  { brandKey: "xiaomi_family", tier: "medium", priorityLevel: "medium", heroCandidate: false, label: "Note 15 Pro Plus 5G 12/512", keywords: ["note 15 pro plus", "5g"], ram: 12, storage: 512 },
  { brandKey: "xiaomi_family", tier: "medium", priorityLevel: "medium", heroCandidate: false, label: "Note 15 Pro 5G 8/256", keywords: ["note 15 pro", "5g"], ram: 8, storage: 256 },
  { brandKey: "xiaomi_family", tier: "medium", priorityLevel: "medium", heroCandidate: false, label: "Note 15 Pro 4G 8/256", keywords: ["note 15 pro", "4g"], ram: 8, storage: 256 },
  { brandKey: "xiaomi_family", tier: "low", priorityLevel: "low", heroCandidate: false, label: "Redmi A7 Pro 4/128", keywords: ["a7 pro"], ram: 4, storage: 128 },
  { brandKey: "xiaomi_family", tier: "low", priorityLevel: "low", heroCandidate: false, label: "15C 8/256", keywords: ["15c"], ram: 8, storage: 256 },
  { brandKey: "xiaomi_family", tier: "low", priorityLevel: "low", heroCandidate: false, label: "Note 15 8/256", keywords: ["note 15"], ram: 8, storage: 256 },
  { brandKey: "iphone", tier: "high", priorityLevel: "high", heroCandidate: true, label: "iPhone 17 Pro Max 256", keywords: ["iphone 17 pro max"], storage: 256 },
  { brandKey: "iphone", tier: "medium", priorityLevel: "medium", heroCandidate: false, label: "iPhone 17 256", keywords: ["iphone 17"], storage: 256 },
  { brandKey: "iphone", tier: "medium", priorityLevel: "medium", heroCandidate: false, label: "iPhone 16 Plus 128", keywords: ["iphone 16 plus"], storage: 128 },
  { brandKey: "iphone", tier: "low", priorityLevel: "low", heroCandidate: false, label: "iPhone 16 128", keywords: ["iphone 16"], storage: 128 },
  { brandKey: "iphone", tier: "low", priorityLevel: "low", heroCandidate: false, label: "iPhone 15 128", keywords: ["iphone 15"], storage: 128 },
];

const REQUIRED_TEMPLATE_CODES_BY_TIER: Record<ContentTier, string[]> = {
  high: ["TS_ORG_PRODUCT_BRAND_GAMMA_FEED_V1", "TS_ORG_MODEL_STORY_V1", "TS_WA_CARD_MODEL_V1", "TS_HERO_MODEL_PREMIUM_V1"],
  medium: ["TS_ORG_PRODUCT_BRAND_GAMMA_FEED_V1", "TS_COMPARE_PAIR_FEED_V1", "TS_ORG_MODEL_STORY_V1", "TS_WA_CARD_MODEL_V1"],
  low: ["TS_ORG_PRODUCT_BRAND_GAMMA_FEED_V1", "TS_ORG_MODEL_STORY_V1", "TS_WA_CARD_MODEL_V1"],
  other: ["TS_ORG_PRODUCT_BRAND_GAMMA_FEED_V1", "TS_WA_CARD_MODEL_V1"],
};

function asFiniteNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function asJsonRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function inferBrandKey(product: ProductCatalogRow): ContentBrandKey | null {
  const text = normalizeText([product.brand, product.model, product.title].join(" "));

  if (text.includes("iphone") || text.includes("apple")) return "iphone";
  if (text.includes("samsung") || text.includes("galaxy")) return "samsung";
  if (text.includes("xiaomi") || text.includes("redmi") || text.includes("poco")) return "xiaomi_family";
  return null;
}

function inferCompareGroupKey(brandKey: ContentBrandKey, tier: ContentTier, text: string) {
  if (brandKey === "samsung" && text.includes("a5")) return "samsung-a5x";
  if (brandKey === "samsung" && text.includes("s2")) return "samsung-s-flagship";
  if (brandKey === "xiaomi_family" && text.includes("note 15 pro")) return "xiaomi-note-15-pro";
  if (brandKey === "xiaomi_family" && text.includes("note 15")) return "xiaomi-note-15";
  if (brandKey === "iphone" && (text.includes("iphone 16") || text.includes("iphone 17"))) return "iphone-mainline";
  return `${brandKey}:${tier}`;
}

function matchStrategicRule(product: ProductCatalogRow) {
  const text = normalizeText([product.brand, product.model, product.title].join(" "));
  const brandKey = inferBrandKey(product);

  if (!brandKey) {
    return {
      brandKey: null,
      tier: "other" as ContentTier,
      priorityLevel: "low" as ContentPriorityLevel,
      heroCandidate: false,
      contentEnabled: false,
      compareGroupKey: null as string | null,
      visualMode: null as string | null,
      matchedLabel: null as string | null,
    };
  }

  const ram = product.ram_gb ?? null;
  const storage = product.storage_gb ?? null;
  const rule = STRATEGIC_MODEL_RULES.find((candidate) => {
    if (candidate.brandKey !== brandKey) return false;
    if (!candidate.keywords.every((keyword) => text.includes(keyword))) return false;
    if (candidate.ram != null && ram != null && candidate.ram !== ram) return false;
    if (candidate.storage != null && storage != null && candidate.storage !== storage) return false;
    return true;
  });

  if (!rule) {
    return {
      brandKey,
      tier: "other" as ContentTier,
      priorityLevel: "low" as ContentPriorityLevel,
      heroCandidate: false,
      contentEnabled: false,
      compareGroupKey: inferCompareGroupKey(brandKey, "other", text),
      visualMode: brandKey === "iphone" ? "premium_restrained" : brandKey === "xiaomi_family" ? "cinematic_technical" : "clean_practical",
      matchedLabel: null as string | null,
    };
  }

  return {
    brandKey,
    tier: rule.tier,
    priorityLevel: rule.priorityLevel,
    heroCandidate: rule.heroCandidate,
    contentEnabled: true,
    compareGroupKey: inferCompareGroupKey(brandKey, rule.tier, text),
    visualMode: rule.heroCandidate ? "premium_selective" : rule.tier === "medium" ? "commercial_operational" : "commercial_clear",
    matchedLabel: rule.label,
  };
}

async function getStoreMeta(executor: SqlExecutor) {
  const result = await executor.query<{ value: unknown }>(
    "select value from public.settings where key = 'store' limit 1"
  );
  const value = result.rows[0]?.value;
  const record = asJsonRecord(value);
  const storefrontUrl = typeof record.storefront_url === "string" && record.storefront_url.trim() ? record.storefront_url.trim() : "https://technostoresalta.com";
  const storeName = typeof record.name === "string" && record.name.trim() ? record.name.trim() : "TechnoStore Salta";

  return {
    storefrontUrl,
    storeName,
  };
}

async function listActiveCatalogProducts(executor: SqlExecutor) {
  const result = await executor.query<ProductCatalogRow & QueryResultRow>(
    `
      select
        p.id,
        p.sku,
        p.slug,
        p.brand,
        p.model,
        p.title,
        p.description,
        p.price_amount,
        p.currency_code,
        p.image_url,
        p.ram_gb,
        p.storage_gb,
        p.color,
        p.active,
        coalesce(p.in_stock, false) as in_stock,
        coalesce(p.stock_units_total, 0)::int as stock_units_total,
        coalesce(p.stock_units_available, 0)::int as stock_units_available,
        p.promo_price_ars
      from (
        select
          p.id,
          p.sku,
          p.slug,
          p.brand,
          p.model,
          p.title,
          p.description,
          p.price_amount,
          p.currency_code,
          p.image_url,
          p.ram_gb,
          p.storage_gb,
          p.color,
          p.active,
          p.updated_at,
          p.promo_price_ars,
          coalesce(count(su.id), 0)::int as stock_units_total,
          coalesce(count(su.id) filter (where su.status = 'in_stock'), 0)::int as stock_units_available,
          coalesce(bool_or(su.status = 'in_stock'), false) as in_stock
        from public.products p
        left join public.stock_units su on su.product_id = p.id
        where p.active = true
        group by p.id
      ) p
      order by p.updated_at desc, p.id desc
    `
  );

  return result.rows;
}

function buildJobTitle(product: ProductCatalogRow, template: ContentTemplateRow) {
  return `${product.brand} ${product.model} · ${template.label}`;
}

function buildCommercialVariables(
  product: ProductCatalogRow,
  profile: ProductContentProfileRow,
  storeMeta: Awaited<ReturnType<typeof getStoreMeta>>
): Record<string, unknown> {
  const priceCash = asFiniteNumber(product.promo_price_ars) ?? asFiniteNumber(product.price_amount);
  const installmentCount = profile.tier === "high" ? 12 : 6;
  const installment = priceCash != null ? Math.round(priceCash / installmentCount) : null;
  const brandLabel = profile.brand_key === "xiaomi_family" ? "Xiaomi / Redmi / Poco" : profile.brand_key === "iphone" ? "iPhone" : "Samsung";
  const variant = [product.ram_gb ? `${product.ram_gb}GB` : null, product.storage_gb ? `${product.storage_gb}GB` : null].filter(Boolean).join("/") || product.model;

  return {
    brand: brandLabel,
    gama: profile.tier,
    model_name: product.model,
    variant,
    storage: product.storage_gb,
    ram: product.ram_gb,
    color_name: product.color ?? null,
    price_cash_ars: priceCash,
    price_installment_ars: installment,
    installment_count: installmentCount,
    promotion_tag: profile.hero_candidate ? "modelo ancla" : profile.priority_level === "medium" ? "consulta por promo" : "",
    warranty_text: "Garantía oficial",
    shipping_text: "Envíos y retiro coordinado",
    store_text: `${storeMeta.storeName} · Salta`,
    payment_text: "Transferencia y financiación disponible",
    cta_text: "Consultá por WhatsApp",
    cta_whatsapp_url: `https://wa.me/${config.STORE_WHATSAPP_PHONE.trim() || "543875319940"}`,
    site_url: storeMeta.storefrontUrl,
    priority_level: profile.priority_level,
    channel: null,
    visual_mode: profile.visual_mode,
    headline_text: product.title,
    feature_1: profile.tier === "high" ? "Premium y diferencial" : profile.tier === "medium" ? "Balance entre precio y equipo" : "Precio claro y simple",
    feature_2: product.ram_gb ? `${product.ram_gb}GB RAM` : "Consulta disponibilidad",
    feature_3: product.storage_gb ? `${product.storage_gb}GB` : "Atención directa",
  };
}

function mapAssetTypeFromJob(job: ContentJobRow) {
  if (job.format === "video" || job.channel === "hero") return "generated_video";
  if (job.channel === "story") return "generated_story";
  if (job.channel === "whatsapp") return "generated_whatsapp";
  if (job.channel === "banner") return "generated_banner";
  return "generated_static";
}

async function persistRemoteOutput(params: {
  sourceUrl: string;
  productId?: number | null;
  suggestedName: string;
}) {
  const response = await fetch(params.sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to download generated asset: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const sourcePath = new URL(params.sourceUrl).pathname;
  const sourceExt = extname(sourcePath);
  const extension =
    sourceExt ||
    (contentType.includes("png")
      ? ".png"
      : contentType.includes("jpeg") || contentType.includes("jpg")
        ? ".jpg"
        : contentType.includes("webp")
          ? ".webp"
          : contentType.includes("mp4")
            ? ".mp4"
            : ".bin");

  const buffer = Buffer.from(await response.arrayBuffer());
  const relativePath = [
    "content",
    "generated",
    params.productId ? String(params.productId) : "shared",
    `${Date.now()}-${randomUUID()}-${basename(params.suggestedName, extname(params.suggestedName))}${extension}`,
  ].join("/");
  const absolutePath = resolve(config.UPLOADS_DIR, relativePath);

  await mkdir(resolve(config.UPLOADS_DIR, "content", "generated", params.productId ? String(params.productId) : "shared"), {
    recursive: true,
  });
  await writeFile(absolutePath, buffer);

  return {
    storage_url: buildMediaPublicUrl(relativePath),
    mime_type: contentType,
  };
}

async function createMediaAsset(executor: SqlExecutor, input: {
  productId?: number | null;
  brandKey?: string | null;
  assetType: (typeof contentAssetTypeValues)[number];
  sourceKind: (typeof contentAssetSourceValues)[number];
  status?: (typeof contentAssetStatusValues)[number];
  title?: string | null;
  storageUrl: string;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  externalAssetId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const result = await executor.query<{ id: number }>(
    `
      insert into public.media_assets (
        product_id,
        brand_key,
        asset_type,
        source_kind,
        status,
        title,
        storage_url,
        mime_type,
        width,
        height,
        duration_ms,
        external_asset_id,
        metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      returning id
    `,
    [
      input.productId ?? null,
      input.brandKey ?? null,
      input.assetType,
      input.sourceKind,
      input.status ?? "draft",
      input.title ?? null,
      input.storageUrl,
      input.mimeType ?? null,
      input.width ?? null,
      input.height ?? null,
      input.durationMs ?? null,
      input.externalAssetId ?? null,
      input.metadata ?? {},
    ]
  );

  return result.rows[0]?.id ?? null;
}

async function createContentOutput(executor: SqlExecutor, input: {
  jobId: number;
  assetId?: number | null;
  variantKey?: string | null;
  reviewStatus?: (typeof contentReviewStatusValues)[number];
  reviewNotes?: string | null;
  outputUrl?: string | null;
  generationPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  const result = await executor.query<{ id: number }>(
    `
      insert into public.content_outputs (
        job_id,
        asset_id,
        variant_key,
        review_status,
        review_notes,
        output_url,
        generation_payload,
        metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning id
    `,
    [
      input.jobId,
      input.assetId ?? null,
      input.variantKey ?? null,
      input.reviewStatus ?? "pending",
      input.reviewNotes ?? null,
      input.outputUrl ?? null,
      input.generationPayload ?? {},
      input.metadata ?? {},
    ]
  );

  return result.rows[0]?.id ?? null;
}

async function findApprovedProductReferenceAsset(executor: SqlExecutor, productId: number) {
  const result = await executor.query<MediaAssetRow>(
    `
      select
        a.id,
        a.product_id,
        a.brand_key,
        a.asset_type,
        a.source_kind,
        a.status,
        a.title,
        a.storage_url,
        a.mime_type,
        a.width,
        a.height,
        a.duration_ms,
        a.external_asset_id,
        a.metadata,
        a.created_at,
        a.updated_at,
        p.sku,
        p.model,
        p.title as product_title
      from public.media_assets a
      left join public.products p on p.id = a.product_id
      where a.product_id = $1
        and a.asset_type = 'product_reference'
        and a.status = 'approved'
      order by a.updated_at desc, a.id desc
      limit 1
    `,
    [productId]
  );

  return result.rows[0] ?? null;
}

export async function ensureContentProductProfiles(executor: SqlExecutor = pool) {
  const products = await listActiveCatalogProducts(executor);

  for (const product of products) {
    const inferred = matchStrategicRule(product);
    if (!inferred.brandKey) {
      continue;
    }

    await executor.query(
      `
        insert into public.product_content_profiles (
          product_id,
          brand_key,
          tier,
          priority_level,
          compare_group_key,
          hero_candidate,
          content_enabled,
          visual_mode,
          metadata
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (product_id) do update set
          brand_key = excluded.brand_key,
          tier = excluded.tier,
          priority_level = excluded.priority_level,
          compare_group_key = excluded.compare_group_key,
          hero_candidate = excluded.hero_candidate,
          content_enabled = excluded.content_enabled,
          visual_mode = excluded.visual_mode,
          metadata = public.product_content_profiles.metadata || excluded.metadata,
          updated_at = now()
      `,
      [
        product.id,
        inferred.brandKey,
        inferred.tier,
        inferred.priorityLevel,
        inferred.compareGroupKey,
        inferred.heroCandidate,
        inferred.contentEnabled,
        inferred.visualMode,
        {
          matched_priority_model: inferred.matchedLabel,
          auto_synced: true,
          stock_units_available: product.stock_units_available,
          stock_units_total: product.stock_units_total,
        },
      ]
    );
  }

  return products.length;
}

export async function listBrandProfiles(executor: SqlExecutor = pool) {
  const result = await executor.query<BrandProfileRow>("select * from public.brand_profiles order by brand_key");
  return result.rows;
}

export async function listContentTemplates(executor: SqlExecutor = pool) {
  const result = await executor.query<ContentTemplateRow>("select * from public.content_templates order by template_code");
  return result.rows;
}

export async function updateContentTemplate(
  executor: SqlExecutor,
  templateId: number,
  input: {
    label?: string;
    engine?: string;
    channel?: string;
    format?: string;
    description?: string | null;
    prompt_text?: string | null;
    definition_json?: Record<string, unknown>;
    active?: boolean;
  }
) {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  }

  if (fields.length === 0) {
    const existing = await executor.query<ContentTemplateRow>("select * from public.content_templates where id = $1 limit 1", [templateId]);
    return existing.rows[0] ?? null;
  }

  values.push(templateId);
  const result = await executor.query<ContentTemplateRow>(
    `update public.content_templates set ${fields.join(", ")}, updated_at = now() where id = $${values.length} returning *`,
    values
  );

  return result.rows[0] ?? null;
}

export async function updateBrandProfile(
  executor: SqlExecutor,
  brandKey: string,
  input: {
    label?: string;
    visual_direction?: string | null;
    theme_json?: Record<string, unknown>;
    active?: boolean;
  }
) {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  }

  if (fields.length === 0) {
    const existing = await executor.query<BrandProfileRow>("select * from public.brand_profiles where brand_key = $1 limit 1", [brandKey]);
    return existing.rows[0] ?? null;
  }

  values.push(brandKey);
  const result = await executor.query<BrandProfileRow>(
    `update public.brand_profiles set ${fields.join(", ")}, updated_at = now() where brand_key = $${values.length} returning *`,
    values
  );

  return result.rows[0] ?? null;
}

export async function listProductContentProfiles(executor: SqlExecutor = pool) {
  await ensureContentProductProfiles(executor);
  const result = await executor.query<
    ProductContentProfileRow &
      QueryResultRow & {
        sku: string;
        slug: string;
        brand: string;
        model: string;
        title: string;
        image_url: string | null;
        price_amount: string | number | null;
        promo_price_ars: string | number | null;
        ram_gb: number | null;
        storage_gb: number | null;
        active: boolean;
        in_stock: boolean;
        stock_units_available: number;
      }
  >(
    `
      select
        cp.*,
        p.sku,
        p.slug,
        p.brand,
        p.model,
        p.title,
        p.image_url,
        p.price_amount,
        p.promo_price_ars,
        p.ram_gb,
        p.storage_gb,
        p.active,
        coalesce(bool_or(su.status = 'in_stock'), false) as in_stock,
        coalesce(count(su.id) filter (where su.status = 'in_stock'), 0)::int as stock_units_available
      from public.product_content_profiles cp
      join public.products p on p.id = cp.product_id
      left join public.stock_units su on su.product_id = p.id
      group by cp.product_id, p.id
      order by cp.content_enabled desc, cp.priority_level desc, p.updated_at desc
    `
  );

  return result.rows;
}

export async function updateProductContentProfile(
  executor: SqlExecutor,
  productId: number,
  input: {
    brand_key?: string;
    tier?: string;
    priority_level?: string;
    compare_group_key?: string | null;
    hero_candidate?: boolean;
    content_enabled?: boolean;
    visual_mode?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  }

  if (fields.length === 0) {
    const existing = await executor.query<ProductContentProfileRow>("select * from public.product_content_profiles where product_id = $1 limit 1", [productId]);
    return existing.rows[0] ?? null;
  }

  values.push(productId);
  const result = await executor.query<ProductContentProfileRow>(
    `update public.product_content_profiles set ${fields.join(", ")}, updated_at = now() where product_id = $${values.length} returning *`,
    values
  );

  return result.rows[0] ?? null;
}

export async function listMediaAssets(executor: SqlExecutor = pool) {
  const result = await executor.query<MediaAssetRow>(
    `
      select
        a.*,
        p.sku,
        p.model,
        p.title as product_title
      from public.media_assets a
      left join public.products p on p.id = a.product_id
      order by a.updated_at desc, a.id desc
    `
  );

  return result.rows;
}

export async function createContentAsset(executor: SqlExecutor, input: {
  product_id?: number | null;
  brand_key?: string | null;
  asset_type: (typeof contentAssetTypeValues)[number];
  source_kind: (typeof contentAssetSourceValues)[number];
  status?: (typeof contentAssetStatusValues)[number];
  title?: string | null;
  storage_url: string;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  external_asset_id?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const assetId = await createMediaAsset(executor, {
    productId: input.product_id ?? null,
    brandKey: input.brand_key ?? null,
    assetType: input.asset_type,
    sourceKind: input.source_kind,
    status: input.status ?? "draft",
    title: input.title ?? null,
    storageUrl: input.storage_url,
    mimeType: input.mime_type ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    durationMs: input.duration_ms ?? null,
    externalAssetId: input.external_asset_id ?? null,
    metadata: input.metadata ?? {},
  });

  const created = await executor.query<MediaAssetRow>(
    `
      select
        a.*,
        p.sku,
        p.model,
        p.title as product_title
      from public.media_assets a
      left join public.products p on p.id = a.product_id
      where a.id = $1
      limit 1
    `,
    [assetId]
  );

  return created.rows[0] ?? null;
}

export async function updateContentAsset(
  executor: SqlExecutor,
  assetId: number,
  input: {
    status?: string;
    title?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  }

  if (fields.length === 0) {
    const existing = await executor.query<MediaAssetRow>("select * from public.media_assets where id = $1 limit 1", [assetId]);
    return existing.rows[0] ?? null;
  }

  values.push(assetId);
  const result = await executor.query<MediaAssetRow>(
    `update public.media_assets set ${fields.join(", ")}, updated_at = now() where id = $${values.length} returning *`,
    values
  );

  return result.rows[0] ?? null;
}

export async function listContentJobs(executor: SqlExecutor = pool) {
  const result = await executor.query<ContentJobRow>(
    `
      select
        j.*,
        t.template_code,
        t.label as template_label,
        p.sku,
        p.model,
        p.title as product_title
      from public.content_jobs j
      left join public.content_templates t on t.id = j.template_id
      left join public.products p on p.id = j.product_id
      order by j.updated_at desc, j.id desc
    `
  );

  return result.rows;
}

async function getContentJobWithRelations(executor: SqlExecutor, jobId: number) {
  const result = await executor.query<
    ContentJobRow &
      QueryResultRow & {
        template_definition_json: Record<string, unknown> | null;
        template_prompt_text: string | null;
        price_amount: string | number | null;
        promo_price_ars: string | number | null;
        image_url: string | null;
        color: string | null;
        ram_gb: number | null;
        storage_gb: number | null;
        product_brand: string | null;
        product_slug: string | null;
      }
  >(
    `
      select
        j.*,
        t.template_code,
        t.label as template_label,
        t.definition_json as template_definition_json,
        t.prompt_text as template_prompt_text,
        p.sku,
        p.slug as product_slug,
        p.brand as product_brand,
        p.model,
        p.title as product_title,
        p.price_amount,
        p.promo_price_ars,
        p.image_url,
        p.color,
        p.ram_gb,
        p.storage_gb
      from public.content_jobs j
      left join public.content_templates t on t.id = j.template_id
      left join public.products p on p.id = j.product_id
      where j.id = $1
      limit 1
    `,
    [jobId]
  );

  return result.rows[0] ?? null;
}

export async function createContentJob(executor: SqlExecutor, input: {
  product_id?: number | null;
  brand_key?: string | null;
  template_id?: number | null;
  engine: (typeof contentEngineValues)[number];
  channel: (typeof contentChannelValues)[number];
  format: (typeof contentFormatValues)[number];
  title: string;
  status?: (typeof contentJobStatusValues)[number];
  priority?: (typeof contentPriorityValues)[number];
  requested_by?: string | null;
  input_json?: Record<string, unknown>;
}) {
  const result = await executor.query<{ id: number }>(
    `
      insert into public.content_jobs (
        product_id,
        brand_key,
        template_id,
        engine,
        channel,
        format,
        title,
        status,
        priority,
        requested_by,
        input_json
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      returning id
    `,
    [
      input.product_id ?? null,
      input.brand_key ?? null,
      input.template_id ?? null,
      input.engine,
      input.channel,
      input.format,
      input.title,
      input.status ?? "planned",
      input.priority ?? "medium",
      input.requested_by ?? null,
      input.input_json ?? {},
    ]
  );

  return getContentJobWithRelations(executor, result.rows[0]?.id ?? 0);
}

export async function updateContentJobStatus(
  executor: SqlExecutor,
  jobId: number,
  input: Partial<{
    status: (typeof contentJobStatusValues)[number];
    external_job_id: string | null;
    external_status: string | null;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
    input_json: Record<string, unknown>;
  }>
) {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  }

  if (fields.length === 0) {
    return getContentJobWithRelations(executor, jobId);
  }

  values.push(jobId);
  await executor.query(`update public.content_jobs set ${fields.join(", ")}, updated_at = now() where id = $${values.length}`, values);
  return getContentJobWithRelations(executor, jobId);
}

export async function listContentOutputs(executor: SqlExecutor = pool) {
  const result = await executor.query<ContentOutputRow>(
    `
      select
        o.*,
        j.title,
        t.template_code,
        j.product_id,
        p.sku,
        p.model,
        p.title as product_title,
        a.storage_url as asset_url
      from public.content_outputs o
      join public.content_jobs j on j.id = o.job_id
      left join public.content_templates t on t.id = j.template_id
      left join public.products p on p.id = j.product_id
      left join public.media_assets a on a.id = o.asset_id
      order by o.updated_at desc, o.id desc
    `
  );

  return result.rows;
}

export async function updateContentOutputReview(
  executor: SqlExecutor,
  outputId: number,
  input: {
    review_status?: (typeof contentReviewStatusValues)[number];
    review_notes?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  }

  if (fields.length === 0) {
    const existing = await executor.query<ContentOutputRow>("select * from public.content_outputs where id = $1 limit 1", [outputId]);
    return existing.rows[0] ?? null;
  }

  values.push(outputId);
  const result = await executor.query<ContentOutputRow>(
    `update public.content_outputs set ${fields.join(", ")}, updated_at = now() where id = $${values.length} returning *`,
    values
  );

  return result.rows[0] ?? null;
}

export async function listContentPublications(executor: SqlExecutor = pool) {
  const result = await executor.query<ContentPublicationRow>(
    `
      select
        pbl.*,
        t.template_code,
        j.product_id,
        p.sku,
        p.model,
        p.title as product_title
      from public.content_publications pbl
      join public.content_outputs o on o.id = pbl.output_id
      join public.content_jobs j on j.id = o.job_id
      left join public.content_templates t on t.id = j.template_id
      left join public.products p on p.id = j.product_id
      order by pbl.updated_at desc, pbl.id desc
    `
  );

  return result.rows;
}

export async function createContentPublication(executor: SqlExecutor, input: {
  output_id: number;
  channel: (typeof contentChannelValues)[number];
  target_account?: string | null;
  platform_post_id?: string | null;
  published_url?: string | null;
  status?: (typeof contentPublicationStatusValues)[number];
  boost_candidate?: boolean;
  boosted?: boolean;
  published_at?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const result = await executor.query<{ id: number }>(
    `
      insert into public.content_publications (
        output_id,
        channel,
        target_account,
        platform_post_id,
        published_url,
        status,
        boost_candidate,
        boosted,
        published_at,
        metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning id
    `,
    [
      input.output_id,
      input.channel,
      input.target_account ?? null,
      input.platform_post_id ?? null,
      input.published_url ?? null,
      input.status ?? "draft",
      input.boost_candidate ?? false,
      input.boosted ?? false,
      input.published_at ?? null,
      input.metadata ?? {},
    ]
  );

  const publication = await executor.query<ContentPublicationRow>("select * from public.content_publications where id = $1 limit 1", [result.rows[0]?.id ?? 0]);
  return publication.rows[0] ?? null;
}

export async function updateContentPublication(
  executor: SqlExecutor,
  publicationId: number,
  input: {
    status?: (typeof contentPublicationStatusValues)[number];
    target_account?: string | null;
    platform_post_id?: string | null;
    published_url?: string | null;
    boost_candidate?: boolean;
    boosted?: boolean;
    published_at?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  }

  if (fields.length === 0) {
    const existing = await executor.query<ContentPublicationRow>("select * from public.content_publications where id = $1 limit 1", [publicationId]);
    return existing.rows[0] ?? null;
  }

  values.push(publicationId);
  const result = await executor.query<ContentPublicationRow>(
    `update public.content_publications set ${fields.join(", ")}, updated_at = now() where id = $${values.length} returning *`,
    values
  );

  return result.rows[0] ?? null;
}

export async function listContentPlannerSuggestions(executor: SqlExecutor = pool) {
  const [profiles, templates, jobs] = await Promise.all([
    listProductContentProfiles(executor),
    listContentTemplates(executor),
    listContentJobs(executor),
  ]);

  const templateMap = new Map(templates.map((template) => [template.template_code, template]));
  const existingByProductTemplate = new Set(
    jobs
      .filter((job) => job.product_id != null && job.template_code && !["failed", "cancelled"].includes(job.status))
      .map((job) => `${job.product_id}:${job.template_code}`)
  );

  const suggestions: PlannerSuggestion[] = [];

  for (const profile of profiles) {
    if (!profile.content_enabled || !profile.active) continue;
    const requiredCodes = REQUIRED_TEMPLATE_CODES_BY_TIER[(profile.tier as ContentTier) ?? "other"] ?? [];

    for (const templateCode of requiredCodes) {
      if (existingByProductTemplate.has(`${profile.product_id}:${templateCode}`)) {
        continue;
      }

      const template = templateMap.get(templateCode);
      if (!template) continue;

      suggestions.push({
        product_id: profile.product_id,
        sku: profile.sku,
        model: profile.model,
        title: profile.title,
        brand_key: profile.brand_key,
        tier: profile.tier,
        priority_level: profile.priority_level,
        template_code: template.template_code,
        template_label: template.label,
        channel: template.channel,
        engine: template.engine,
        format: template.format,
        reason:
          templateCode === "TS_COMPARE_PAIR_FEED_V1"
            ? "Missing comparison coverage for a medium-tier product."
            : templateCode === "TS_HERO_MODEL_PREMIUM_V1"
              ? "Anchor model needs a premium hero asset."
              : "Missing required baseline coverage from the operating matrix.",
        hero_candidate: profile.hero_candidate,
      });
    }
  }

  return suggestions.sort((left, right) => {
    const priorityWeight = { high: 0, medium: 1, low: 2 } as const;
    const leftWeight = priorityWeight[left.priority_level as keyof typeof priorityWeight] ?? 3;
    const rightWeight = priorityWeight[right.priority_level as keyof typeof priorityWeight] ?? 3;
    if (leftWeight !== rightWeight) return leftWeight - rightWeight;
    if (left.brand_key !== right.brand_key) return left.brand_key.localeCompare(right.brand_key);
    return left.model.localeCompare(right.model);
  });
}

export async function createPlannedJobsFromSuggestions(
  executor: SqlExecutor,
  options: {
    productId?: number | null;
    limit?: number;
    requestedBy?: string | null;
  } = {}
) {
  const suggestions = await listContentPlannerSuggestions(executor);
  const storeMeta = await getStoreMeta(executor);
  const templates = await listContentTemplates(executor);
  const templateMap = new Map(templates.map((template) => [template.template_code, template]));
  const profiles = await listProductContentProfiles(executor);
  const profileMap = new Map(profiles.map((profile) => [profile.product_id, profile]));

  const filtered = suggestions
    .filter((suggestion) => (options.productId != null ? suggestion.product_id === options.productId : true))
    .slice(0, options.limit ?? 50);

  const created: ContentJobRow[] = [];

  for (const suggestion of filtered) {
    const template = templateMap.get(suggestion.template_code);
    const profile = profileMap.get(suggestion.product_id);
    if (!template || !profile) continue;

    const product = {
      id: profile.product_id,
      sku: profile.sku,
      slug: profile.slug,
      brand: profile.brand,
      model: profile.model,
      title: profile.title,
      description: null,
      price_amount: profile.price_amount,
      currency_code: "ARS",
      image_url: profile.image_url,
      ram_gb: profile.ram_gb,
      storage_gb: profile.storage_gb,
      color: null,
      active: profile.active,
      in_stock: profile.in_stock,
      stock_units_total: 0,
      stock_units_available: profile.stock_units_available,
      promo_price_ars: profile.promo_price_ars,
    } satisfies ProductCatalogRow;

    const variables = buildCommercialVariables(
      product,
      {
        product_id: profile.product_id,
        brand_key: profile.brand_key,
        tier: profile.tier,
        priority_level: profile.priority_level,
        compare_group_key: profile.compare_group_key,
        hero_candidate: profile.hero_candidate,
        content_enabled: profile.content_enabled,
        visual_mode: profile.visual_mode,
        metadata: profile.metadata,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
      },
      storeMeta
    );
    variables.channel = template.channel;

    const job = await createContentJob(executor, {
      product_id: suggestion.product_id,
      brand_key: suggestion.brand_key,
      template_id: template.id,
      engine: template.engine as (typeof contentEngineValues)[number],
      channel: template.channel as (typeof contentChannelValues)[number],
      format: template.format as (typeof contentFormatValues)[number],
      title: buildJobTitle(product, template),
      priority:
        suggestion.priority_level === "high" ? "high" : suggestion.priority_level === "medium" ? "medium" : "low",
      requested_by: options.requestedBy ?? "content_planner",
      input_json: {
        variables,
        reason: suggestion.reason,
      },
    });

    if (job) created.push(job);
  }

  return created;
}

export async function runContentJob(executor: SqlExecutor, jobId: number) {
  const job = await getContentJobWithRelations(executor, jobId);
  if (!job) {
    throw new Error(`Content job ${jobId} not found.`);
  }

  if (!job.template_id || !job.template_code) {
    throw new Error(`Content job ${jobId} is missing a template.`);
  }

  const templateConfig = asJsonRecord(job.template_definition_json);
  const variables = asJsonRecord(job.input_json.variables);
  const metadata = asJsonRecord(job.input_json.metadata);

  await updateContentJobStatus(executor, jobId, {
    status: job.engine === "runway" ? "generating" : "queued",
    started_at: new Date().toISOString(),
    error_message: null,
  });

  if (job.engine === "orshot") {
    const referenceAsset = job.product_id ? await findApprovedProductReferenceAsset(executor, job.product_id) : null;
    if (!variables.product_reference_image_url && referenceAsset?.storage_url) {
      variables.product_reference_image_url = referenceAsset.storage_url;
    }

    const templateId = (job.input_json.provider_template_id as string | undefined)?.trim() || (templateConfig.provider_template_id as string | undefined)?.trim();
    if (!templateId) {
      throw new Error(`Template ${job.template_code} needs definition_json.provider_template_id before it can run on Orshot.`);
    }

    const response = await renderOrshotStudioTemplate({
      templateId,
      modifications: variables,
      format: typeof templateConfig.response_format === "string" ? templateConfig.response_format : "png",
      responseType: (typeof templateConfig.response_type === "string" ? templateConfig.response_type : "url") as "url" | "binary" | "base64",
      metadata: {
        job_id: job.id,
        product_id: job.product_id,
        template_code: job.template_code,
        ...metadata,
      },
    });

    if (!response.url) {
      throw new Error(`Orshot render for job ${jobId} did not return a URL.`);
    }

    const persisted = await persistRemoteOutput({
      sourceUrl: response.url,
      productId: job.product_id,
      suggestedName: `${job.template_code}-${job.product_id ?? "shared"}`,
    });

    const assetId = await createMediaAsset(executor, {
      productId: job.product_id,
      brandKey: job.brand_key,
      assetType: mapAssetTypeFromJob(job),
      sourceKind: "orshot",
      status: "draft",
      title: job.title,
      storageUrl: persisted.storage_url,
      mimeType: persisted.mime_type,
      externalAssetId: response.id ?? null,
      metadata: {
        orshot_response: response,
      },
    });

    await createContentOutput(executor, {
      jobId: job.id,
      assetId,
      variantKey: "primary",
      reviewStatus: "pending",
      outputUrl: persisted.storage_url,
      generationPayload: {
        orshot_response: response,
      },
      metadata: {
        engine: "orshot",
      },
    });

    return updateContentJobStatus(executor, job.id, {
      status: "review_required",
      external_job_id: response.id ?? null,
      external_status: "completed",
      completed_at: new Date().toISOString(),
    });
  }

  const runwayTaskType =
    (job.input_json.runway_task_type as string | undefined)?.trim() ||
    (templateConfig.runway_task_type as string | undefined)?.trim() ||
    (job.format === "video" ? "image_to_video" : "text_to_image");

  if (runwayTaskType === "image_to_video") {
    const referenceAsset = job.product_id ? await findApprovedProductReferenceAsset(executor, job.product_id) : null;
    const promptImage =
      (job.input_json.promptImage as string | undefined)?.trim() ||
      (referenceAsset?.storage_url ? referenceAsset.storage_url : "") ||
      (typeof job.image_url === "string" ? job.image_url : "");

    if (!promptImage) {
      throw new Error(`Runway image_to_video job ${jobId} needs an approved product_reference asset or promptImage.`);
    }

    const task = await createRunwayImageToVideoTask({
      model: (templateConfig.runway_model as string | undefined)?.trim() || undefined,
      promptImage,
      promptText:
        (job.input_json.prompt_text as string | undefined)?.trim() ||
        (typeof job.template_prompt_text === "string" ? job.template_prompt_text : undefined),
      ratio: (templateConfig.ratio as string | undefined)?.trim() || undefined,
      duration: asFiniteNumber(templateConfig.duration) ?? undefined,
    });

    return updateContentJobStatus(executor, job.id, {
      status: "generating",
      external_job_id: task.id,
      external_status: task.status ?? "PENDING",
    });
  }

  const task = await createRunwayTextToImageTask({
    promptText:
      (job.input_json.prompt_text as string | undefined)?.trim() ||
      (typeof job.template_prompt_text === "string" ? job.template_prompt_text : `Create a premium content asset for ${job.product_title ?? "TechnoStore"}.`),
    model: (templateConfig.runway_model as string | undefined)?.trim() || undefined,
    ratio: (templateConfig.ratio as string | undefined)?.trim() || undefined,
  });

  return updateContentJobStatus(executor, job.id, {
    status: "generating",
    external_job_id: task.id,
    external_status: task.status ?? "PENDING",
  });
}

export async function syncContentJob(executor: SqlExecutor, jobId: number) {
  const job = await getContentJobWithRelations(executor, jobId);
  if (!job) {
    throw new Error(`Content job ${jobId} not found.`);
  }

  if (job.engine !== "runway") {
    return job;
  }

  if (!job.external_job_id) {
    throw new Error(`Content job ${jobId} has no external Runway task id.`);
  }

  const task = await getRunwayTask(job.external_job_id);
  const status = (task.status ?? "UNKNOWN").toString().toUpperCase();

  if (status === "SUCCEEDED") {
    const existingOutputs = await executor.query<{ count: string }>("select count(*)::text as count from public.content_outputs where job_id = $1", [job.id]);
    if (Number(existingOutputs.rows[0]?.count ?? 0) === 0) {
      const outputUrl = task.output?.find((entry) => entry.url)?.url ?? null;
      if (!outputUrl) {
        throw new Error(`Runway task ${job.external_job_id} succeeded but returned no output URL.`);
      }

      const persisted = await persistRemoteOutput({
        sourceUrl: outputUrl,
        productId: job.product_id,
        suggestedName: `${job.template_code}-${job.product_id ?? "shared"}`,
      });

      const assetId = await createMediaAsset(executor, {
        productId: job.product_id,
        brandKey: job.brand_key,
        assetType: mapAssetTypeFromJob(job),
        sourceKind: "runway",
        status: "draft",
        title: job.title,
        storageUrl: persisted.storage_url,
        mimeType: persisted.mime_type,
        externalAssetId: task.id,
        metadata: {
          runway_task: task,
        },
      });

      await createContentOutput(executor, {
        jobId: job.id,
        assetId,
        variantKey: "primary",
        reviewStatus: "pending",
        outputUrl: persisted.storage_url,
        generationPayload: {
          runway_task: task,
        },
        metadata: {
          engine: "runway",
        },
      });
    }

    return updateContentJobStatus(executor, job.id, {
      status: "review_required",
      external_status: status,
      completed_at: new Date().toISOString(),
      error_message: null,
    });
  }

  if (status === "FAILED" || status === "CANCELLED") {
    return updateContentJobStatus(executor, job.id, {
      status: "failed",
      external_status: status,
      error_message: task.failure ?? `Runway task ${status.toLowerCase()}.`,
      completed_at: new Date().toISOString(),
    });
  }

  return updateContentJobStatus(executor, job.id, {
    status: "generating",
    external_status: status,
  });
}

export async function handleOrshotWebhook(executor: SqlExecutor, payload: unknown) {
  const body = asJsonRecord(payload);
  const data = asJsonRecord(body.data);
  const metadata = asJsonRecord(body.metadata);
  const resolvedMetadata = Object.keys(metadata).length > 0 ? metadata : asJsonRecord(data.metadata);
  const jobIdRaw = resolvedMetadata.job_id ?? body.job_id ?? data.job_id;
  const externalJobId =
    (typeof body.id === "string" && body.id.trim()) ||
    (typeof data.id === "string" && data.id.trim()) ||
    null;
  const externalStatus =
    (typeof body.status === "string" && body.status.trim()) ||
    (typeof data.status === "string" && data.status.trim()) ||
    "completed";
  const outputUrl =
    (typeof body.url === "string" && body.url.trim()) ||
    (typeof data.url === "string" && data.url.trim()) ||
    null;

  const jobId =
    typeof jobIdRaw === "number"
      ? jobIdRaw
      : typeof jobIdRaw === "string" && jobIdRaw.trim()
        ? Number(jobIdRaw)
        : null;

  if (!jobId || !Number.isFinite(jobId)) {
    return {
      ok: true,
      ignored: true,
      reason: "missing_job_id",
    };
  }

  const job = await getContentJobWithRelations(executor, jobId);
  if (!job) {
    return {
      ok: true,
      ignored: true,
      reason: "job_not_found",
      job_id: jobId,
    };
  }

  if (outputUrl) {
    const persisted = await persistRemoteOutput({
      sourceUrl: outputUrl,
      productId: job.product_id,
      suggestedName: `${job.template_code ?? "orshot"}-${job.product_id ?? "shared"}`,
    });

    const assetId = await createMediaAsset(executor, {
      productId: job.product_id,
      brandKey: job.brand_key,
      assetType: mapAssetTypeFromJob(job),
      sourceKind: "orshot",
      status: "draft",
      title: job.title,
      storageUrl: persisted.storage_url,
      mimeType: persisted.mime_type,
      externalAssetId: externalJobId,
      metadata: {
        orshot_webhook: body,
      },
    });

    await createContentOutput(executor, {
      jobId: job.id,
      assetId,
      variantKey: "webhook",
      reviewStatus: "pending",
      outputUrl: persisted.storage_url,
      generationPayload: {
        orshot_webhook: body,
      },
      metadata: {
        engine: "orshot",
        delivery: "webhook",
      },
    });
  }

  await updateContentJobStatus(executor, job.id, {
    status: outputUrl ? "review_required" : "generated",
    external_job_id: externalJobId,
    external_status: externalStatus,
    completed_at: new Date().toISOString(),
    error_message: null,
  });

  return {
    ok: true,
    job_id: job.id,
    external_job_id: externalJobId,
    external_status: externalStatus,
  };
}

export async function getContentOverview(executor: SqlExecutor = pool) {
  await ensureContentProductProfiles(executor);

  const [brands, templates, profiles, assets, jobs, outputs, publications, suggestions] = await Promise.all([
    listBrandProfiles(executor),
    listContentTemplates(executor),
    listProductContentProfiles(executor),
    listMediaAssets(executor),
    listContentJobs(executor),
    listContentOutputs(executor),
    listContentPublications(executor),
    listContentPlannerSuggestions(executor),
  ]);

  const byStatus = <T extends { status: string }>(items: T[]) =>
    items.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});
  const outputsByReview = outputs.reduce<Record<string, number>>((acc, output) => {
    acc[output.review_status] = (acc[output.review_status] ?? 0) + 1;
    return acc;
  }, {});

  let orshotRemoteTemplates = null as Awaited<ReturnType<typeof listOrshotStudioTemplates>> | null;
  let orshotError: string | null = null;
  try {
    if (config.ORSHOT_API_KEY.trim()) {
      orshotRemoteTemplates = await listOrshotStudioTemplates({ limit: 25 });
    }
  } catch (error) {
    orshotError = error instanceof Error ? error.message : "Failed to fetch Orshot studio templates";
  }

  return {
    configured: {
      orshot: {
        api_base_url: config.ORSHOT_API_BASE_URL.trim() || "https://api.orshot.com",
        api_key: Boolean(config.ORSHOT_API_KEY.trim()),
        webhook_url: config.ORSHOT_WEBHOOK_URL.trim() || null,
      },
      runway: {
        api_base_url: config.RUNWAY_API_BASE_URL.trim() || "https://api.dev.runwayml.com",
        api_secret: Boolean(config.RUNWAYML_API_SECRET.trim()),
        api_version: config.RUNWAY_API_VERSION.trim() || "2024-11-06",
      },
    },
    counts: {
      brands: brands.length,
      templates: templates.length,
      enabled_profiles: profiles.filter((profile) => profile.content_enabled).length,
      assets: assets.length,
      jobs: jobs.length,
      outputs: outputs.length,
      publications: publications.length,
      suggestions: suggestions.length,
    },
    jobs_by_status: byStatus(jobs),
    publications_by_status: byStatus(publications),
    outputs_by_review: outputsByReview,
    brands,
    templates,
    profiles,
    assets,
    jobs,
    outputs,
    publications,
    suggestions,
    providers: {
      orshot_templates: orshotRemoteTemplates,
      orshot_error: orshotError,
    },
  };
}
