function labelize(value: string) {
  return value.replace(/[_-]+/g, " ");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function formatLeaf(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((entry) => formatLeaf(entry)).join(", ");
  return JSON.stringify(value);
}

export function SettingView({ value }: { value: unknown }) {
  if (isPlainRecord(value)) {
    const entries = Object.entries(value);

    return (
      <dl className="setting-list">
        {entries.map(([key, entryValue]) => (
          <div key={key} className="setting-row">
            <dt className="setting-term">{labelize(key)}</dt>
            <dd className="setting-detail">{formatLeaf(entryValue)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return <div className="setting-value-card">{formatLeaf(value)}</div>;
}
