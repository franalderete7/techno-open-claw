import type { Pool, PoolClient } from "pg";
import { pool } from "./db.js";

type SqlExecutor = Pick<Pool, "query"> | Pick<PoolClient, "query">;

type PricingSettings = {
  defaultLogisticsUsd: number;
  defaultUsdRate: number;
  defaultCuotasQty: number;
  bancarizadaInterest: number;
  macroInterest: number;
  marginBands: Array<{
    band: number;
    maxCostUsd: number;
    marginPct: number;
  }>;
};

export type PricingCarrier = {
  cost_usd?: number | string | null;
  logistics_usd?: number | string | null;
  usd_rate?: number | string | null;
  cuotas_qty?: number | string | null;
};

export type DerivedPricingFields = {
  logistics_usd: number;
  total_cost_usd: number | null;
  margin_pct: number | null;
  price_usd: number | null;
  usd_rate: number;
  price_amount: number | null;
  promo_price_ars: number | null;
  bancarizada_interest: number;
  bancarizada_total: number | null;
  bancarizada_cuota: number | null;
  macro_interest: number;
  macro_total: number | null;
  macro_cuota: number | null;
  cuotas_qty: number;
};

const PRICING_SETTING_KEYS = [
  "pricing_default_logistics_usd",
  "logistics_usd",
  "pricing_default_usd_rate",
  "usd_to_ars",
  "pricing_default_cuotas_qty",
  "cuotas_qty",
  "pricing_bancarizada_interest",
  "bancarizada_interest",
  "pricing_macro_interest",
  "macro_interest",
  "pricing_margin_band_1_max_cost_usd",
  "pricing_margin_band_1_margin_pct",
  "pricing_margin_band_2_max_cost_usd",
  "pricing_margin_band_2_margin_pct",
  "pricing_margin_band_3_max_cost_usd",
  "pricing_margin_band_3_margin_pct",
  "pricing_margin_band_4_max_cost_usd",
  "pricing_margin_band_4_margin_pct",
] as const;

function asFiniteNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function roundAmount(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundArs(value: number) {
  return Math.round(value);
}

function getRequiredSettingNumber(
  settings: Map<string, unknown>,
  candidates: readonly string[],
  label: string
) {
  for (const candidate of candidates) {
    const parsed = asFiniteNumber(settings.get(candidate));
    if (parsed != null) {
      return parsed;
    }
  }

  throw new Error(`Falta el setting requerido para ${label}: ${candidates.join(" / ")}`);
}

async function loadPricingSettings(executor: SqlExecutor = pool): Promise<PricingSettings> {
  const result = await executor.query<{ key: string; value: unknown }>(
    `
      select key, value
      from public.settings
      where key = any($1::text[])
    `,
    [Array.from(PRICING_SETTING_KEYS)]
  );

  const settings = new Map(result.rows.map((row) => [row.key, row.value]));
  const marginBands: PricingSettings["marginBands"] = [];

  for (let band = 1; band <= 12; band += 1) {
    const maxCostUsd = asFiniteNumber(settings.get(`pricing_margin_band_${band}_max_cost_usd`));
    const marginPct = asFiniteNumber(settings.get(`pricing_margin_band_${band}_margin_pct`));

    if (maxCostUsd == null && marginPct == null) {
      continue;
    }

    if (maxCostUsd == null || marginPct == null) {
      throw new Error(`La configuración pricing_margin_band_${band} está incompleta.`);
    }

    marginBands.push({ band, maxCostUsd, marginPct });
  }

  if (marginBands.length === 0) {
    throw new Error("No hay bandas de margen configuradas en settings.");
  }

  marginBands.sort((left, right) => left.maxCostUsd - right.maxCostUsd);

  return {
    defaultLogisticsUsd: getRequiredSettingNumber(
      settings,
      ["pricing_default_logistics_usd", "logistics_usd"],
      "logística USD"
    ),
    defaultUsdRate: getRequiredSettingNumber(
      settings,
      ["pricing_default_usd_rate", "usd_to_ars"],
      "cotización USD->ARS"
    ),
    defaultCuotasQty: Math.round(
      getRequiredSettingNumber(settings, ["pricing_default_cuotas_qty", "cuotas_qty"], "cantidad de cuotas")
    ),
    bancarizadaInterest: getRequiredSettingNumber(
      settings,
      ["pricing_bancarizada_interest", "bancarizada_interest"],
      "interés bancarizada"
    ),
    macroInterest: getRequiredSettingNumber(settings, ["pricing_macro_interest", "macro_interest"], "interés macro"),
    marginBands,
  };
}

function selectMarginPct(costUsd: number, settings: PricingSettings) {
  const matched = settings.marginBands.find((band) => costUsd <= band.maxCostUsd);
  return (matched || settings.marginBands[settings.marginBands.length - 1]).marginPct;
}

export function shouldRecalculatePricing(changes: Record<string, unknown>) {
  return ["cost_usd", "logistics_usd", "usd_rate", "cuotas_qty"].some((key) => key in changes);
}

export async function calculateDerivedPricing(
  carrier: PricingCarrier,
  executor: SqlExecutor = pool
): Promise<DerivedPricingFields> {
  const settings = await loadPricingSettings(executor);
  const costUsd = asFiniteNumber(carrier.cost_usd ?? null);
  const logisticsUsd = asFiniteNumber(carrier.logistics_usd ?? null) ?? settings.defaultLogisticsUsd;
  const usdRate = asFiniteNumber(carrier.usd_rate ?? null) ?? settings.defaultUsdRate;
  const cuotasQty = Math.round(asFiniteNumber(carrier.cuotas_qty ?? null) ?? settings.defaultCuotasQty);

  if (costUsd == null) {
    return {
      logistics_usd: logisticsUsd,
      total_cost_usd: null,
      margin_pct: null,
      price_usd: null,
      usd_rate: usdRate,
      price_amount: null,
      promo_price_ars: null,
      bancarizada_interest: settings.bancarizadaInterest,
      bancarizada_total: null,
      bancarizada_cuota: null,
      macro_interest: settings.macroInterest,
      macro_total: null,
      macro_cuota: null,
      cuotas_qty: cuotasQty,
    };
  }

  const marginPct = selectMarginPct(costUsd, settings);
  const totalCostUsd = roundAmount(costUsd + logisticsUsd);
  const priceUsd = roundAmount(totalCostUsd * (1 + marginPct));
  const priceArs = roundArs(priceUsd * usdRate);
  const bancarizadaTotal = roundArs(priceArs * (1 + settings.bancarizadaInterest));
  const macroTotal = roundArs(priceArs * (1 + settings.macroInterest));

  return {
    logistics_usd: logisticsUsd,
    total_cost_usd: totalCostUsd,
    margin_pct: marginPct,
    price_usd: priceUsd,
    usd_rate: usdRate,
    price_amount: priceArs,
    promo_price_ars: priceArs,
    bancarizada_interest: settings.bancarizadaInterest,
    bancarizada_total: bancarizadaTotal,
    bancarizada_cuota: cuotasQty > 0 ? roundArs(bancarizadaTotal / cuotasQty) : null,
    macro_interest: settings.macroInterest,
    macro_total: macroTotal,
    macro_cuota: cuotasQty > 0 ? roundArs(macroTotal / cuotasQty) : null,
    cuotas_qty: cuotasQty,
  };
}
