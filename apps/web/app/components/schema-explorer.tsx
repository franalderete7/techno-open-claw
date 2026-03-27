"use client";

import { useDeferredValue, useState } from "react";
import type { SchemaRelationshipRecord, SchemaTableRecord } from "../../lib/api";
import { SearchToolbar } from "./search-toolbar";

type SchemaExplorerProps = {
  tables: SchemaTableRecord[];
  relationships: SchemaRelationshipRecord[];
};

export function SchemaExplorer({ tables, relationships }: SchemaExplorerProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  const filteredTables = tables.filter((table) => {
    const matchesQuery =
      needle.length === 0 ||
      [
        table.name,
        ...table.columns.flatMap((column) => [
          column.name,
          column.data_type,
          column.default_value ?? "",
          column.references?.table ?? "",
          column.references?.column ?? "",
        ]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);

    const matchesFilter =
      filter === "all" ||
      (filter === "related" && table.relationship_count > 0) ||
      (filter === "dense" && table.columns.length >= 8) ||
      (filter === "lean" && table.columns.length < 8);

    return matchesQuery && matchesFilter;
  });

  const visibleTableNames = new Set(filteredTables.map((table) => table.name));
  const filteredRelationships = relationships.filter((relationship) => {
    const matchesQuery =
      needle.length === 0 ||
      [
        relationship.constraint_name,
        relationship.source_table,
        relationship.source_column,
        relationship.target_table,
        relationship.target_column,
        relationship.update_rule,
        relationship.delete_rule,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);

    const matchesTables =
      filter !== "all" ? visibleTableNames.has(relationship.source_table) || visibleTableNames.has(relationship.target_table) : true;

    return matchesQuery && matchesTables;
  });

  return (
    <div className="page-stack">
      <SearchToolbar
        label="Search schema"
        placeholder="Search by table, column, type, or referenced table"
        query={query}
        onQueryChange={setQuery}
        totalCount={tables.length}
        resultCount={filteredTables.length}
        filters={[
          { value: "all", label: "All tables", count: tables.length },
          { value: "related", label: "With links", count: tables.filter((table) => table.relationship_count > 0).length },
          { value: "dense", label: "Dense", count: tables.filter((table) => table.columns.length >= 8).length },
          { value: "lean", label: "Lean", count: tables.filter((table) => table.columns.length < 8).length },
        ]}
        activeFilter={filter}
        onFilterChange={setFilter}
      />

      <section className="panel schema-summary-panel">
        <div className="chip-row">
          <span className="chip accent">{tables.length} tables</span>
          <span className="chip good">{relationships.length} relationships</span>
          <span className="chip warn">
            {tables.reduce((count, table) => count + table.columns.length, 0)} columns
          </span>
        </div>
      </section>

      {filteredTables.length === 0 ? (
        <section className="panel">
          <p className="empty">No schema tables match this search.</p>
        </section>
      ) : (
        <section className="schema-table-grid reveal-grid">
          {filteredTables.map((table) => {
            const previewColumns = table.columns.slice(0, 4);

            return (
              <article key={table.name} className="schema-table-card">
                <div className="record-header">
                  <div>
                    <p className="catalog-kicker">public</p>
                    <h3 className="record-title">{table.name}</h3>
                  </div>
                  <div className="chip-row">
                    <span className="chip">{table.columns.length} cols</span>
                    {table.relationship_count > 0 ? <span className="chip good">{table.relationship_count} links</span> : null}
                    <span className="chip mono">~{table.row_estimate}</span>
                  </div>
                </div>

                <div className="schema-column-list schema-column-preview">
                  {previewColumns.map((column) => (
                    <div key={column.name} className="schema-column-row">
                      <div className="schema-column-main">
                        <strong className="mono">{column.name}</strong>
                        <span className="muted">{column.data_type}</span>
                      </div>
                      <div className="chip-row">
                        {column.is_primary_key ? <span className="chip accent">PK</span> : null}
                        {column.references ? <span className="chip good">FK</span> : null}
                        {!column.is_nullable ? <span className="chip">required</span> : <span className="chip warn">nullable</span>}
                      </div>
                    </div>
                  ))}
                </div>

                {table.columns.length > previewColumns.length ? (
                  <details className="schema-fold">
                    <summary className="field-summary fold-summary">
                      <span>Columns</span>
                      <span className="fold-meta">
                        {table.columns.length - previewColumns.length} more rows
                      </span>
                    </summary>
                    <div className="schema-column-list">
                      {table.columns.slice(previewColumns.length).map((column) => (
                        <div key={column.name} className="schema-column-row">
                          <div className="schema-column-main">
                            <strong className="mono">{column.name}</strong>
                            <span className="muted">{column.data_type}</span>
                          </div>
                          <div className="chip-row">
                            {column.is_primary_key ? <span className="chip accent">PK</span> : null}
                            {column.references ? <span className="chip good">FK</span> : null}
                            {!column.is_nullable ? <span className="chip">required</span> : <span className="chip warn">nullable</span>}
                          </div>
                          {column.references ? (
                            <p className="schema-reference">
                              → {column.references.table}.{column.references.column}
                            </p>
                          ) : column.default_value ? (
                            <p className="schema-reference mono">{column.default_value}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </article>
            );
          })}
        </section>
      )}

      {filteredRelationships.length > 0 ? (
        <details className="field-details schema-relationship-panel">
          <summary className="field-summary fold-summary">
            <span>Relationships</span>
            <span className="fold-meta">{filteredRelationships.length} links</span>
          </summary>
          <div className="schema-relationship-grid reveal-grid">
            {filteredRelationships.map((relationship) => (
              <article key={relationship.constraint_name} className="schema-link-card">
                <div className="chip-row">
                  <span className="chip accent mono">{relationship.constraint_name}</span>
                </div>
                <div className="schema-link-flow">
                  <div>
                    <strong>{relationship.source_table}</strong>
                    <span className="muted mono">{relationship.source_column}</span>
                  </div>
                  <span className="schema-link-arrow">→</span>
                  <div>
                    <strong>{relationship.target_table}</strong>
                    <span className="muted mono">{relationship.target_column}</span>
                  </div>
                </div>
                <div className="chip-row">
                  <span className="chip">on update {relationship.update_rule.toLowerCase()}</span>
                  <span className="chip">on delete {relationship.delete_rule.toLowerCase()}</span>
                </div>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
