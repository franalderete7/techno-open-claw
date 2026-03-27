"use client";

import { useId } from "react";

export type SearchFilterOption = {
  value: string;
  label: string;
  count?: number;
};

type SearchToolbarProps = {
  label: string;
  placeholder: string;
  query: string;
  onQueryChange: (value: string) => void;
  totalCount: number;
  resultCount: number;
  filters?: SearchFilterOption[];
  activeFilter?: string;
  onFilterChange?: (value: string) => void;
};

export function SearchToolbar({
  label,
  placeholder,
  query,
  onQueryChange,
  totalCount,
  resultCount,
  filters = [],
  activeFilter,
  onFilterChange,
}: SearchToolbarProps) {
  const inputId = useId();

  return (
    <section className="search-toolbar">
      <div className="search-toolbar-head">
        <label htmlFor={inputId} className="search-toolbar-label">
          {label}
        </label>
        <span className="search-toolbar-meta">
          {resultCount} of {totalCount}
        </span>
      </div>

      <div className="search-toolbar-body">
        <div className="search-input-wrap">
          <span className="search-input-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            id={inputId}
            type="search"
            className="search-input"
            placeholder={placeholder}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
      </div>

      {filters.length > 0 && activeFilter && onFilterChange ? (
        <div className="filter-strip">
          {filters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={`filter-chip ${activeFilter === filter.value ? "active" : ""}`}
              onClick={() => onFilterChange(filter.value)}
            >
              <span>{filter.label}</span>
              {filter.count != null ? <strong>{filter.count}</strong> : null}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
