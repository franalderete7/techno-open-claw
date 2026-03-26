import type { Pool, PoolClient } from "pg";
import { pool } from "./db.js";

type SqlExecutor = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export const inventoryPurchaseStatusValues = ["draft", "received", "cancelled"] as const;

export type InventoryPurchaseFunderInput = {
  funder_name: string;
  payment_method?: string | null;
  amount_amount?: number | string | null;
  currency_code?: string | null;
  share_pct?: number | string | null;
  notes?: string | null;
};

export type InventoryPurchaseInput = {
  supplier_name?: string | null;
  currency_code?: string | null;
  total_amount?: number | string | null;
  status?: (typeof inventoryPurchaseStatusValues)[number];
  acquired_at?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
  funders?: InventoryPurchaseFunderInput[] | null;
};

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

function normalizeSharePct(value: unknown) {
  const numeric = asFiniteNumber(value);
  if (numeric == null) {
    return null;
  }

  if (numeric > 1 && numeric <= 100) {
    return roundAmount(numeric / 100, 4);
  }

  return roundAmount(numeric, 4);
}

function normalizeFunders(
  funders: InventoryPurchaseFunderInput[] | null | undefined,
  totalAmount: number | null,
  purchaseCurrency: string
) {
  return (funders || [])
    .map((funder) => {
      const amountAmount = asFiniteNumber(funder.amount_amount ?? null);
      const sharePct = normalizeSharePct(funder.share_pct ?? null);
      const derivedAmount = amountAmount ?? (sharePct != null && totalAmount != null ? roundAmount(totalAmount * sharePct) : null);
      const derivedShare =
        sharePct ?? (amountAmount != null && totalAmount != null && totalAmount > 0 ? roundAmount(amountAmount / totalAmount, 4) : null);

      return {
        funder_name: funder.funder_name.trim(),
        payment_method: funder.payment_method?.trim() || null,
        amount_amount: derivedAmount,
        currency_code: funder.currency_code?.trim() || purchaseCurrency,
        share_pct: derivedShare,
        notes: funder.notes?.trim() || null,
      };
    })
    .filter((funder) => funder.funder_name);
}

async function replacePurchaseFunders(
  executor: SqlExecutor,
  purchaseId: number,
  funders: InventoryPurchaseFunderInput[] | null | undefined,
  totalAmount: number | null,
  currencyCode: string
) {
  await executor.query("delete from public.inventory_purchase_funders where inventory_purchase_id = $1", [purchaseId]);

  const normalized = normalizeFunders(funders, totalAmount, currencyCode);
  for (const funder of normalized) {
    await executor.query(
      `
        insert into public.inventory_purchase_funders (
          inventory_purchase_id,
          funder_name,
          payment_method,
          amount_amount,
          currency_code,
          share_pct,
          notes
        ) values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        purchaseId,
        funder.funder_name,
        funder.payment_method,
        funder.amount_amount,
        funder.currency_code,
        funder.share_pct,
        funder.notes,
      ]
    );
  }
}

export async function getInventoryPurchaseDetail(executor: SqlExecutor, purchaseId: number) {
  const result = await executor.query<{
    id: number;
    purchase_number: string;
    supplier_name: string | null;
    currency_code: string;
    total_amount: string | number | null;
    status: string;
    acquired_at: string | null;
    notes: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    funders: unknown;
    stock_units_total: number;
    stock_units_in_stock: number;
    stock_units_sold: number;
  }>(
    `
      select
        p.id,
        p.purchase_number,
        p.supplier_name,
        p.currency_code,
        p.total_amount,
        p.status,
        p.acquired_at,
        p.notes,
        p.metadata,
        p.created_at,
        p.updated_at,
        coalesce(
          jsonb_agg(
            distinct jsonb_build_object(
              'id', f.id,
              'funder_name', f.funder_name,
              'payment_method', f.payment_method,
              'amount_amount', f.amount_amount,
              'currency_code', f.currency_code,
              'share_pct', f.share_pct,
              'notes', f.notes
            )
          ) filter (where f.id is not null),
          '[]'::jsonb
        ) as funders,
        coalesce(count(distinct su.id), 0)::int as stock_units_total,
        coalesce(count(distinct su.id) filter (where su.status = 'in_stock'), 0)::int as stock_units_in_stock,
        coalesce(count(distinct su.id) filter (where su.status = 'sold'), 0)::int as stock_units_sold
      from public.inventory_purchases p
      left join public.inventory_purchase_funders f on f.inventory_purchase_id = p.id
      left join public.stock_units su on su.inventory_purchase_id = p.id
      where p.id = $1
      group by p.id
      limit 1
    `,
    [purchaseId]
  );

  return result.rows[0] ?? null;
}

export async function createInventoryPurchase(executor: SqlExecutor, input: InventoryPurchaseInput) {
  const currencyCode = input.currency_code?.trim() || "USD";
  const totalAmount = asFiniteNumber(input.total_amount ?? null);
  const result = await executor.query<{ id: number }>(
    `
      insert into public.inventory_purchases (
        supplier_name,
        currency_code,
        total_amount,
        status,
        acquired_at,
        notes,
        metadata
      ) values ($1, $2, $3, $4, $5, $6, $7)
      returning id
    `,
    [
      input.supplier_name?.trim() || null,
      currencyCode,
      totalAmount,
      input.status || "draft",
      input.acquired_at ?? null,
      input.notes?.trim() || null,
      input.metadata || {},
    ]
  );

  const purchaseId = result.rows[0].id;
  await replacePurchaseFunders(executor, purchaseId, input.funders, totalAmount, currencyCode);
  return getInventoryPurchaseDetail(executor, purchaseId);
}

export async function updateInventoryPurchase(
  executor: SqlExecutor,
  purchaseId: number,
  changes: Partial<InventoryPurchaseInput>
) {
  const entries = Object.entries(changes).filter(([key, value]) => key !== "funders" && value !== undefined);

  if (entries.length > 0) {
    const sql = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
    const values = entries.map(([key, value]) => {
      if (key === "currency_code") {
        return typeof value === "string" ? value.trim() || "USD" : "USD";
      }

      if (key === "total_amount") {
        return asFiniteNumber(value);
      }

      if (key === "supplier_name" || key === "notes") {
        return typeof value === "string" ? value.trim() || null : null;
      }

      return value;
    });

    await executor.query(
      `
        update public.inventory_purchases
        set ${sql}
        where id = $${values.length + 1}
      `,
      [...values, purchaseId]
    );
  }

  const detail = await getInventoryPurchaseDetail(executor, purchaseId);
  if (!detail) {
    return null;
  }

  if (changes.funders !== undefined) {
    await replacePurchaseFunders(
      executor,
      purchaseId,
      changes.funders,
      asFiniteNumber(detail.total_amount),
      detail.currency_code
    );
  }

  return getInventoryPurchaseDetail(executor, purchaseId);
}

export async function listInventoryPurchases(
  executor: SqlExecutor = pool,
  filters: {
    query?: string;
    status?: string;
    limit?: number;
  } = {}
) {
  const values: unknown[] = [];
  const where: string[] = [];

  if (filters.query) {
    values.push(`%${filters.query}%`);
    where.push(
      `(p.purchase_number ilike $${values.length} or coalesce(p.supplier_name, '') ilike $${values.length} or coalesce(p.notes, '') ilike $${values.length})`
    );
  }

  if (filters.status) {
    values.push(filters.status);
    where.push(`p.status = $${values.length}`);
  }

  values.push(filters.limit ?? 50);

  const result = await executor.query(
    `
      select
        p.id,
        p.purchase_number,
        p.supplier_name,
        p.currency_code,
        p.total_amount,
        p.status,
        p.acquired_at,
        p.created_at,
        coalesce(count(distinct f.id), 0)::int as funders_count,
        coalesce(count(distinct su.id), 0)::int as stock_units_count
      from public.inventory_purchases p
      left join public.inventory_purchase_funders f on f.inventory_purchase_id = p.id
      left join public.stock_units su on su.inventory_purchase_id = p.id
      ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
      group by p.id
      order by coalesce(p.acquired_at, p.created_at) desc, p.id desc
      limit $${values.length}
    `,
    values
  );

  return result.rows;
}

export async function resolveInventoryPurchase(executor: SqlExecutor, purchaseRef: string) {
  const trimmed = purchaseRef.trim();
  const exactId = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const result = await executor.query<{
    id: number;
    purchase_number: string;
    supplier_name: string | null;
    status: string;
    total_amount: string | number | null;
    currency_code: string;
    acquired_at: string | null;
  }>(
    `
      select id, purchase_number, supplier_name, status, total_amount, currency_code, acquired_at
      from public.inventory_purchases
      where
        ($1::bigint is not null and id = $1)
        or lower(purchase_number) = lower($2)
        or coalesce(supplier_name, '') ilike $3
        or coalesce(notes, '') ilike $3
      order by
        case
          when ($1::bigint is not null and id = $1) then 0
          when lower(purchase_number) = lower($2) then 1
          else 2
        end,
        coalesce(acquired_at, created_at) desc,
        id desc
      limit 5
    `,
    [exactId, trimmed, `%${trimmed}%`]
  );

  const rows = result.rows;
  if (rows.length === 0) {
    throw new Error(`No encontré una compra para "${purchaseRef}".`);
  }

  const exactRows = rows.filter(
    (row) => row.id === exactId || row.purchase_number.toLowerCase() === trimmed.toLowerCase()
  );

  if (exactRows.length === 1) {
    return exactRows[0];
  }

  if (rows.length > 1) {
    throw new Error(
      `La compra es ambigua. Coincidencias: ${rows
        .slice(0, 5)
        .map((row) => `${row.purchase_number}${row.supplier_name ? ` (${row.supplier_name})` : ""}`)
        .join(" | ")}`
    );
  }

  return rows[0];
}
