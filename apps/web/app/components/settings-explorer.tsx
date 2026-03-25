"use client";

import { useDeferredValue, useState } from "react";
import type { SettingRecord } from "../../lib/api";
import { SettingView } from "./setting-view";
import { SearchToolbar } from "./search-toolbar";

type SettingsExplorerProps = {
  items: SettingRecord[];
};

function labelize(value: string) {
  return value.replace(/[_-]+/g, " ");
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function getSettingGroup(key: string) {
  if (key === "store" || key.startsWith("store_")) return "store";
  if (key.startsWith("pricing_") || key === "usd_to_ars" || key === "logistics_usd") return "pricing";
  if (key.startsWith("customer_") || key.includes("payment")) return "payments";
  if (key.includes("bot") || key.includes("workflow")) return "automation";
  return "operations";
}

function getSettingCardClass(setting: { key: string; value: unknown }) {
  const classes = ["setting-card"];

  if (setting.key === "store") {
    classes.push("setting-card-featured");
  } else if (
    isPlainRecord(setting.value) ||
    (typeof setting.value === "string" && setting.value.length > 110) ||
    setting.key.includes("policy") ||
    setting.key.includes("payment_methods")
  ) {
    classes.push("setting-card-wide");
  }

  return classes.join(" ");
}

export function SettingsExplorer({ items }: SettingsExplorerProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  const orderedItems = [...items].sort((left, right) => {
    if (left.key === "store") return -1;
    if (right.key === "store") return 1;
    return left.key.localeCompare(right.key);
  });

  const filteredItems = orderedItems.filter((setting) => {
    const matchesQuery =
      needle.length === 0 ||
      [setting.key, setting.description ?? "", normalizeValue(setting.value)].join(" ").toLowerCase().includes(needle);

    const group = getSettingGroup(setting.key);
    const matchesFilter = filter === "all" || filter === group;

    return matchesQuery && matchesFilter;
  });

  const groups = ["all", "store", "pricing", "payments", "automation", "operations"];

  return (
    <div className="page-stack">
      <SearchToolbar
        label="Search settings"
        placeholder="Search by key, description, policy text, or value"
        query={query}
        onQueryChange={setQuery}
        totalCount={items.length}
        resultCount={filteredItems.length}
        filters={groups.map((group) => ({
          value: group,
          label: group === "all" ? "All" : group,
          count: group === "all" ? items.length : items.filter((item) => getSettingGroup(item.key) === group).length,
        }))}
        activeFilter={filter}
        onFilterChange={setFilter}
      />

      {filteredItems.length === 0 ? (
        <section className="panel">
          <p className="empty">No settings match this search.</p>
        </section>
      ) : (
        <section className="settings-layout reveal-grid">
          {filteredItems.map((setting) => (
            <article key={setting.key} className={getSettingCardClass(setting)}>
              <div className="panel-header setting-card-header">
                <div>
                  <h3>{labelize(setting.key)}</h3>
                  <p className="setting-key mono">{setting.key}</p>
                </div>
                <p className="panel-copy">Updated {formatDate(setting.updated_at)}</p>
              </div>

              <div className="setting-entry-body setting-card-body">
                <SettingView value={setting.value} />
              </div>

              {setting.description ? <p className="setting-caption">{setting.description}</p> : null}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
