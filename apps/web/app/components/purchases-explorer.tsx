"use client";

import { useDeferredValue, useState } from "react";
import type { InventoryPurchaseDetailRecord, InventoryPurchaseStockUnitRecord } from "../../lib/api";
import { SearchToolbar } from "./search-toolbar";

type PurchasesExplorerProps = {
  items: InventoryPurchaseDetailRecord[];
};

type ProfitAggregate = {
  soldUnits: number;
  realizedUnits: number;
  missingProfitUnits: number;
  revenueArs: number;
  costArs: number;
  profitArs: number;
  funders: Record<string, { revenueArs: number; costArs: number; profitArs: number }>;
};

type ProfitPoint = {
  key: string;
  label: string;
  soldUnits: number;
  realizedUnits: number;
  missingProfitUnits: number;
  revenueArs: number;
  costArs: number;
  profitArs: number;
  funders: Record<string, { revenueArs: number; costArs: number; profitArs: number }>;
};

const FUNDERS = ["aldegol", "chueco"] as const;
const PROFIT_TIME_ZONE = "America/Argentina/Salta";

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

function roundAmount(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatMoney(amount: number | null, currency = "ARS") {
  if (amount == null) return "-";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: PROFIT_TIME_ZONE,
  });
}

function formatNullable(value: unknown) {
  if (value == null || value === "") return "-";
  return String(value);
}

function toDisplayFunderName(name: string) {
  if (name === "aldegol") return "Aldegol";
  if (name === "chueco") return "Chueco";
  return name;
}

function getLocalDateParts(value: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: PROFIT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return { year, month, day };
}

function buildBucketInfo(value: string, groupBy: "day" | "month") {
  const { year, month, day } = getLocalDateParts(value);
  const key = groupBy === "day" ? `${year}-${month}-${day}` : `${year}-${month}`;
  const label = new Intl.DateTimeFormat("es-AR", {
    timeZone: PROFIT_TIME_ZONE,
    month: "short",
    day: groupBy === "day" ? "numeric" : undefined,
    year: groupBy === "month" ? "2-digit" : undefined,
  })
    .format(new Date(`${key}${groupBy === "day" ? "T00:00:00" : "-01T00:00:00"}`))
    .replace(".", "");

  return { key, label };
}

function createAggregate(): ProfitAggregate {
  return {
    soldUnits: 0,
    realizedUnits: 0,
    missingProfitUnits: 0,
    revenueArs: 0,
    costArs: 0,
    profitArs: 0,
    funders: {},
  };
}

function resolveFunderShares(purchase: InventoryPurchaseDetailRecord) {
  const explicitShares = purchase.funders
    .map((funder) => ({
      name: funder.funder_name,
      share: asFiniteNumber(funder.share_pct),
    }))
    .filter((entry) => entry.share != null && entry.share > 0);

  if (explicitShares.length > 0) {
    const totalShare = explicitShares.reduce((sum, entry) => sum + (entry.share ?? 0), 0);
    if (totalShare > 0) {
      return Object.fromEntries(explicitShares.map((entry) => [entry.name, (entry.share ?? 0) / totalShare]));
    }
  }

  const purchaseTotal = asFiniteNumber(purchase.total_amount);
  const amountShares = purchase.funders
    .map((funder) => ({
      name: funder.funder_name,
      amount: asFiniteNumber(funder.amount_amount),
    }))
    .filter((entry) => entry.amount != null && entry.amount > 0);

  if (amountShares.length > 0 && purchaseTotal != null && purchaseTotal > 0) {
    const totalAmount = amountShares.reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
    if (totalAmount > 0) {
      return Object.fromEntries(amountShares.map((entry) => [entry.name, (entry.amount ?? 0) / totalAmount]));
    }
  }

  if (purchase.funders.length === 0) {
    return {};
  }

  const evenShare = 1 / purchase.funders.length;
  return Object.fromEntries(purchase.funders.map((funder) => [funder.funder_name, evenShare]));
}

function collectProfitData(
  purchases: InventoryPurchaseDetailRecord[],
  groupBy: "day" | "month",
  from: string,
  to: string
) {
  const points = new Map<string, ProfitPoint>();
  const totals = createAggregate();

  for (const purchase of purchases) {
    const funderShares = resolveFunderShares(purchase);

    for (const unit of purchase.stock_units) {
      const soldMarker = unit.sale_recorded_at ?? unit.sold_at;
      if (!soldMarker || unit.status !== "sold") {
        continue;
      }

      const dayKey = buildBucketInfo(soldMarker, "day").key;
      if (from && dayKey < from) continue;
      if (to && dayKey > to) continue;

      const bucket = buildBucketInfo(soldMarker, groupBy);
      const aggregate =
        points.get(bucket.key) ??
        {
          key: bucket.key,
          label: bucket.label,
          ...createAggregate(),
        };

      aggregate.soldUnits += 1;
      totals.soldUnits += 1;

      const revenueArs = asFiniteNumber(unit.revenue_amount_ars);
      const costArs = asFiniteNumber(unit.cost_amount_ars);
      const profitArs = asFiniteNumber(unit.profit_amount_ars);

      if (revenueArs == null || costArs == null || profitArs == null || Object.keys(funderShares).length === 0) {
        aggregate.missingProfitUnits += 1;
        totals.missingProfitUnits += 1;
        points.set(bucket.key, aggregate);
        continue;
      }

      aggregate.realizedUnits += 1;
      aggregate.revenueArs = roundAmount(aggregate.revenueArs + revenueArs);
      aggregate.costArs = roundAmount(aggregate.costArs + costArs);
      aggregate.profitArs = roundAmount(aggregate.profitArs + profitArs);

      totals.realizedUnits += 1;
      totals.revenueArs = roundAmount(totals.revenueArs + revenueArs);
      totals.costArs = roundAmount(totals.costArs + costArs);
      totals.profitArs = roundAmount(totals.profitArs + profitArs);

      for (const [funderName, share] of Object.entries(funderShares)) {
        const revenueShare = roundAmount(revenueArs * share);
        const costShare = roundAmount(costArs * share);
        const profitShare = roundAmount(profitArs * share);
        const currentPoint = aggregate.funders[funderName] ?? { revenueArs: 0, costArs: 0, profitArs: 0 };
        const currentTotal = totals.funders[funderName] ?? { revenueArs: 0, costArs: 0, profitArs: 0 };

        aggregate.funders[funderName] = {
          revenueArs: roundAmount(currentPoint.revenueArs + revenueShare),
          costArs: roundAmount(currentPoint.costArs + costShare),
          profitArs: roundAmount(currentPoint.profitArs + profitShare),
        };

        totals.funders[funderName] = {
          revenueArs: roundAmount(currentTotal.revenueArs + revenueShare),
          costArs: roundAmount(currentTotal.costArs + costShare),
          profitArs: roundAmount(currentTotal.profitArs + profitShare),
        };
      }

      points.set(bucket.key, aggregate);
    }
  }

  return {
    totals,
    points: Array.from(points.values()).sort((left, right) => left.key.localeCompare(right.key)),
  };
}

function pickFunderMetric(
  aggregate: ProfitAggregate | ProfitPoint,
  funderFilter: "all" | (typeof FUNDERS)[number],
  field: "revenueArs" | "costArs" | "profitArs"
) {
  if (funderFilter === "all") {
    return aggregate[field];
  }

  return aggregate.funders[funderFilter]?.[field] ?? 0;
}

function buildPurchaseQueryText(purchase: InventoryPurchaseDetailRecord) {
  return [
    purchase.purchase_number,
    purchase.supplier_name ?? "",
    purchase.status,
    purchase.notes ?? "",
    ...purchase.funders.map((funder) => funder.funder_name),
    ...purchase.stock_units.flatMap((unit) => [
      unit.sku,
      unit.brand,
      unit.model,
      unit.title,
      unit.serial_number ?? "",
      unit.imei_1 ?? "",
      unit.imei_2 ?? "",
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function renderUnitIdentifiers(unit: InventoryPurchaseStockUnitRecord) {
  return [unit.serial_number, unit.imei_1, unit.imei_2].filter(Boolean).join(" · ") || "-";
}

export function PurchasesExplorer({ items }: PurchasesExplorerProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [groupBy, setGroupBy] = useState<"day" | "month">("month");
  const [funderFilter, setFunderFilter] = useState<"all" | (typeof FUNDERS)[number]>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  const filteredItems = items.filter((purchase) => {
    const matchesQuery = needle.length === 0 || buildPurchaseQueryText(purchase).includes(needle);
    const matchesStatus = statusFilter === "all" || purchase.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  const profitData = collectProfitData(filteredItems, groupBy, from, to);
  const peakValue = Math.max(
    ...profitData.points.map((point) => Math.abs(pickFunderMetric(point, funderFilter, "profitArs"))),
    1
  );

  const statusOptions = [
    { value: "all", label: "All", count: items.length },
    { value: "draft", label: "Draft", count: items.filter((item) => item.status === "draft").length },
    { value: "received", label: "Received", count: items.filter((item) => item.status === "received").length },
    { value: "cancelled", label: "Cancelled", count: items.filter((item) => item.status === "cancelled").length },
  ];

  return (
    <div className="page-stack">
      <SearchToolbar
        label="Search purchases"
        placeholder="Search by purchase number, supplier, funder, SKU, serial, or IMEI"
        query={query}
        onQueryChange={setQuery}
        totalCount={items.length}
        resultCount={filteredItems.length}
        filters={statusOptions}
        activeFilter={statusFilter}
        onFilterChange={setStatusFilter}
      />

      <section className="panel purchase-insights-panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Realized Profit</h3>
            <p className="panel-copy">Based on sold stock units linked to paid or fulfilled orders.</p>
          </div>
        </div>

        <div className="purchase-toolbar-row">
          <div className="chip-row">
            <button
              type="button"
              className={`filter-chip ${groupBy === "day" ? "active" : ""}`}
              onClick={() => setGroupBy("day")}
            >
              <span>By day</span>
            </button>
            <button
              type="button"
              className={`filter-chip ${groupBy === "month" ? "active" : ""}`}
              onClick={() => setGroupBy("month")}
            >
              <span>By month</span>
            </button>
          </div>

          <div className="purchase-toolbar-inputs">
            <label className="toolbar-control">
              <span>Funder</span>
              <select value={funderFilter} onChange={(event) => setFunderFilter(event.target.value as "all" | (typeof FUNDERS)[number])}>
                <option value="all">All funders</option>
                {FUNDERS.map((funder) => (
                  <option key={funder} value={funder}>
                    {toDisplayFunderName(funder)}
                  </option>
                ))}
              </select>
            </label>
            <label className="toolbar-control">
              <span>From</span>
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="toolbar-control">
              <span>To</span>
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
          </div>
        </div>

        <div className="stats-grid purchase-profit-stats">
          <article className="stat-card">
            <span className="stat-label">Profit</span>
            <strong className="stat-value">{formatMoney(pickFunderMetric(profitData.totals, funderFilter, "profitArs"))}</strong>
            <span className="stat-note">{funderFilter === "all" ? "Split by funders" : toDisplayFunderName(funderFilter)}</span>
          </article>
          <article className="stat-card">
            <span className="stat-label">Revenue</span>
            <strong className="stat-value">{formatMoney(pickFunderMetric(profitData.totals, funderFilter, "revenueArs"))}</strong>
            <span className="stat-note">{profitData.totals.realizedUnits} realized units</span>
          </article>
          <article className="stat-card">
            <span className="stat-label">Cost</span>
            <strong className="stat-value">{formatMoney(pickFunderMetric(profitData.totals, funderFilter, "costArs"))}</strong>
            <span className="stat-note">{profitData.totals.soldUnits} sold units</span>
          </article>
          <article className="stat-card">
            <span className="stat-label">Missing P/L</span>
            <strong className="stat-value">{profitData.totals.missingProfitUnits}</strong>
            <span className="stat-note">Sold units without revenue or cost attribution</span>
          </article>
        </div>

        {profitData.points.length === 0 ? (
          <p className="empty">No sold stock units match the current filters yet.</p>
        ) : (
          <>
            <div className="profit-legend">
              <span className="chip legend-chip legend-aldegol">Aldegol</span>
              <span className="chip legend-chip legend-chueco">Chueco</span>
            </div>
            <div className="profit-chart">
              {profitData.points.map((point) => {
                const selectedProfit = pickFunderMetric(point, funderFilter, "profitArs");
                const totalHeight = Math.max(8, Math.round((Math.abs(selectedProfit) / peakValue) * 100));
                const funderValues = FUNDERS.map((funder) => ({
                  funder,
                  profit: point.funders[funder]?.profitArs ?? 0,
                }));
                const stackedTotal = funderValues.reduce((sum, entry) => sum + Math.abs(entry.profit), 0) || 1;

                return (
                  <div key={point.key} className="profit-bar-group">
                    <div className="profit-bar-shell">
                      <div
                        className={`profit-bar-stack ${selectedProfit < 0 ? "is-negative" : ""}`}
                        style={{ height: `${totalHeight}%` }}
                      >
                        {funderFilter === "all" ? (
                          funderValues.map((entry) => (
                            <div
                              key={entry.funder}
                              className={`profit-segment profit-segment-${entry.funder}`}
                              style={{ height: `${Math.max(0, (Math.abs(entry.profit) / stackedTotal) * 100)}%` }}
                            />
                          ))
                        ) : (
                          <div className={`profit-segment profit-segment-${funderFilter}`} style={{ height: "100%" }} />
                        )}
                      </div>
                    </div>
                    <strong className="profit-bar-value">{formatMoney(selectedProfit)}</strong>
                    <span className="profit-bar-label">{point.label}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {filteredItems.length === 0 ? (
        <section className="panel">
          <p className="empty">No inventory purchases match this search.</p>
        </section>
      ) : (
        <section className="purchase-list reveal-grid">
          {filteredItems.map((purchase) => {
            const funderShares = resolveFunderShares(purchase);

            return (
              <article key={purchase.id} className="record-card purchase-card">
                <div className="record-header">
                  <div>
                    <p className="catalog-kicker">Inventory purchase</p>
                    <h3 className="record-title">{purchase.purchase_number}</h3>
                    <p className="record-subtitle">{purchase.supplier_name || "No supplier loaded"}</p>
                  </div>
                  <span
                    className={`pill ${
                      purchase.status === "received" ? "good" : purchase.status === "cancelled" ? "danger" : "warn"
                    }`}
                  >
                    {purchase.status}
                  </span>
                </div>

                <div className="chip-row">
                  {purchase.funders.length > 0 ? (
                    purchase.funders.map((funder) => {
                      const sharePct = asFiniteNumber(funder.share_pct);
                      const normalizedShare = sharePct != null ? roundAmount((funderShares[funder.funder_name] ?? sharePct) * 100) : null;

                      return (
                        <span key={funder.id} className="chip accent">
                          {toDisplayFunderName(funder.funder_name)}
                          {normalizedShare != null ? ` ${normalizedShare}%` : ""}
                        </span>
                      );
                    })
                  ) : (
                    <span className="chip warn">No funders yet</span>
                  )}
                </div>

                {purchase.notes ? <p className="panel-copy">{purchase.notes}</p> : null}

                <dl className="record-meta-grid">
                  <div>
                    <dt>Total</dt>
                    <dd>{formatMoney(asFiniteNumber(purchase.total_amount), purchase.currency_code)}</dd>
                  </div>
                  <div>
                    <dt>Acquired</dt>
                    <dd>{formatDate(purchase.acquired_at ?? purchase.created_at)}</dd>
                  </div>
                  <div>
                    <dt>Units</dt>
                    <dd>{purchase.stock_units_total}</dd>
                  </div>
                  <div>
                    <dt>Sold</dt>
                    <dd>{purchase.stock_units_sold}</dd>
                  </div>
                </dl>

                <details className="field-details purchase-stock-details" open={purchase.stock_units.length <= 3}>
                  <summary className="field-summary fold-summary">
                    <span>Stock units</span>
                    <span className="fold-meta">{purchase.stock_units.length} linked</span>
                  </summary>

                  {purchase.stock_units.length === 0 ? (
                    <p className="empty">No stock units linked to this purchase yet.</p>
                  ) : (
                    <div className="table-wrap purchase-stock-table">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Unit</th>
                            <th>Identifiers</th>
                            <th>Status</th>
                            <th>Cost</th>
                            <th>Sale</th>
                            <th>Profit split</th>
                          </tr>
                        </thead>
                        <tbody>
                          {purchase.stock_units.map((unit) => {
                            const realizedProfit = asFiniteNumber(unit.profit_amount_ars);
                            const realizedRevenue = asFiniteNumber(unit.revenue_amount_ars);

                            return (
                              <tr key={unit.id}>
                                <td>
                                  <strong>{unit.sku}</strong>
                                  <div className="muted">{unit.title}</div>
                                </td>
                                <td>
                                  <div>{renderUnitIdentifiers(unit)}</div>
                                  <div className="muted">{formatNullable(unit.location_code)}</div>
                                </td>
                                <td>
                                  <span
                                    className={`pill ${
                                      unit.status === "sold"
                                        ? "warn"
                                        : unit.status === "in_stock"
                                          ? "good"
                                          : unit.status === "damaged"
                                            ? "danger"
                                            : ""
                                    }`}
                                  >
                                    {unit.status.replace(/_/g, " ")}
                                  </span>
                                  <div className="muted">{formatDate(unit.sale_recorded_at ?? unit.acquired_at)}</div>
                                </td>
                                <td>{formatMoney(asFiniteNumber(unit.cost_amount_ars))}</td>
                                <td>
                                  <div>{formatMoney(realizedRevenue)}</div>
                                  <div className="muted">{unit.sold_order_number ? `Order ${unit.sold_order_number}` : "No paid order"}</div>
                                </td>
                                <td>
                                  {realizedProfit == null ? (
                                    <span className="muted">Missing revenue/cost</span>
                                  ) : (
                                    <div className="chip-row">
                                      {Object.entries(funderShares).map(([funderName, share]) => (
                                        <span key={funderName} className="chip">
                                          {toDisplayFunderName(funderName)} {formatMoney(roundAmount(realizedProfit * share))}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </details>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
