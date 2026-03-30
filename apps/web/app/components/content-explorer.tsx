import type { ContentOverviewResponse } from "../../lib/api";

type ContentExplorerProps = {
  snapshot: ContentOverviewResponse;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatNullable(value: unknown) {
  if (value == null || value === "") return "-";
  return String(value);
}

function toLabel(value: string) {
  return value.replace(/_/g, " ");
}

function statusTone(value: string | null | undefined) {
  const normalized = (value ?? "").toLowerCase();
  if (normalized.includes("approved") || normalized.includes("published") || normalized.includes("review_required")) return "good";
  if (normalized.includes("queued") || normalized.includes("planned") || normalized.includes("draft") || normalized.includes("generating")) return "warn";
  if (normalized.includes("failed") || normalized.includes("rejected") || normalized.includes("archived")) return "danger";
  return "";
}

export function ContentExplorer({ snapshot }: ContentExplorerProps) {
  return (
    <div className="page-stack">
      <section className="stats-grid">
        <article className="stat-card">
          <span className="stat-label">Enabled profiles</span>
          <strong className="stat-value">{snapshot.counts.enabled_profiles}</strong>
          <span className="stat-note">{snapshot.suggestions.length} missing pieces</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Jobs</span>
          <strong className="stat-value">{snapshot.counts.jobs}</strong>
          <span className="stat-note">{snapshot.jobs_by_status.review_required ?? 0} waiting review</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Outputs</span>
          <strong className="stat-value">{snapshot.counts.outputs}</strong>
          <span className="stat-note">{snapshot.outputs_by_review.approved ?? 0} approved</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Assets</span>
          <strong className="stat-value">{snapshot.counts.assets}</strong>
          <span className="stat-note">{snapshot.assets.filter((asset) => asset.status === "approved").length} approved</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Publications</span>
          <strong className="stat-value">{snapshot.counts.publications}</strong>
          <span className="stat-note">{snapshot.publications_by_status.published ?? 0} published</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Remote templates</span>
          <strong className="stat-value">{snapshot.providers.orshot_templates?.total ?? 0}</strong>
          <span className="stat-note">{snapshot.configured.orshot.api_key ? "Orshot linked" : "Awaiting API key"}</span>
        </article>
      </section>

      <section className="split-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">Providers</h3>
              <p className="panel-copy">Orshot carries the repeatable volume. Runway stays selective and premium.</p>
            </div>
          </div>

          <div className="chip-row">
            <span className={`chip ${snapshot.configured.orshot.api_key ? "good" : "warn"}`}>Orshot API</span>
            <span className={`chip ${snapshot.configured.runway.api_secret ? "good" : "warn"}`}>Runway API</span>
            <span className="chip accent mono">{snapshot.configured.runway.api_version}</span>
          </div>

          <dl className="record-meta-grid">
            <div>
              <dt>Orshot base</dt>
              <dd className="mono">{snapshot.configured.orshot.api_base_url}</dd>
            </div>
            <div>
              <dt>Runway base</dt>
              <dd className="mono">{snapshot.configured.runway.api_base_url}</dd>
            </div>
            <div>
              <dt>Webhook</dt>
              <dd className="mono">{snapshot.configured.orshot.webhook_url ?? "-"}</dd>
            </div>
            <div>
              <dt>Orshot templates</dt>
              <dd>{snapshot.providers.orshot_templates?.total ?? 0}</dd>
            </div>
          </dl>

          {snapshot.providers.orshot_error ? <p className="record-note">{snapshot.providers.orshot_error}</p> : null}
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">Brand System</h3>
              <p className="panel-copy">Seeded directly from the v2 operating document so the visual logic starts deterministic.</p>
            </div>
          </div>

          <div className="content-brand-grid">
            {snapshot.brands.map((brand) => (
              <article key={brand.brand_key} className="content-brand-card">
                <div className="record-header">
                  <div>
                    <h4 className="record-title">{brand.label}</h4>
                    <p className="record-subtitle">{brand.visual_direction ?? "-"}</p>
                  </div>
                  <span className={`chip ${brand.active ? "good" : "warn"}`}>{brand.active ? "active" : "paused"}</span>
                </div>
                <p className="record-note">{formatNullable(brand.theme_json.notes)}</p>
              </article>
            ))}
          </div>
        </article>
      </section>

      <article className="panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Planner Gaps</h3>
            <p className="panel-copy">These are the missing assets OpenClaw should plan next from the current strategic catalog.</p>
          </div>
        </div>
        {snapshot.suggestions.length === 0 ? (
          <p className="empty">No planner gaps right now.</p>
        ) : (
          <div className="content-grid">
            {snapshot.suggestions.slice(0, 18).map((suggestion) => (
              <article key={`${suggestion.product_id}-${suggestion.template_code}`} className="content-card">
                <div className="record-header">
                  <div>
                    <h4 className="record-title">{suggestion.model}</h4>
                    <p className="record-subtitle">{suggestion.sku}</p>
                  </div>
                  <div className="chip-row">
                    <span className={`chip ${suggestion.priority_level === "high" ? "accent" : suggestion.priority_level === "medium" ? "warn" : ""}`}>{suggestion.priority_level}</span>
                    <span className={`chip ${suggestion.hero_candidate ? "good" : ""}`}>{suggestion.tier}</span>
                  </div>
                </div>
                <dl className="record-meta-grid">
                  <div>
                    <dt>Template</dt>
                    <dd>{suggestion.template_label}</dd>
                  </div>
                  <div>
                    <dt>Engine</dt>
                    <dd>{suggestion.engine}</dd>
                  </div>
                  <div>
                    <dt>Channel</dt>
                    <dd>{toLabel(suggestion.channel)}</dd>
                  </div>
                  <div>
                    <dt>Reason</dt>
                    <dd>{suggestion.reason}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </article>

      <details className="field-details">
        <summary className="field-summary fold-summary">
          <span>Templates</span>
          <span className="chip accent">{snapshot.templates.length}</span>
        </summary>
        <div className="content-list">
          {snapshot.templates.map((template) => (
            <article key={template.id} className="content-list-card">
              <div className="record-header">
                <div>
                  <h4 className="record-title">{template.label}</h4>
                  <p className="record-subtitle mono">{template.template_code}</p>
                </div>
                <div className="chip-row">
                  <span className="chip">{template.engine}</span>
                  <span className="chip">{template.channel}</span>
                  <span className="chip">{template.format}</span>
                </div>
              </div>
              <p className="record-note">{template.description ?? "No description."}</p>
            </article>
          ))}
        </div>
      </details>

      <details className="field-details">
        <summary className="field-summary fold-summary">
          <span>Product Profiles</span>
          <span className="chip accent">{snapshot.profiles.length}</span>
        </summary>
        <div className="content-list">
          {snapshot.profiles.map((profile) => (
            <article key={profile.product_id} className="content-list-card">
              <div className="record-header">
                <div>
                  <h4 className="record-title">{profile.title}</h4>
                  <p className="record-subtitle mono">{profile.sku}</p>
                </div>
                <div className="chip-row">
                  <span className={`chip ${profile.content_enabled ? "good" : "warn"}`}>{profile.content_enabled ? "enabled" : "disabled"}</span>
                  <span className="chip">{profile.brand_key}</span>
                  <span className="chip">{profile.tier}</span>
                </div>
              </div>
              <dl className="record-meta-grid">
                <div>
                  <dt>Priority</dt>
                  <dd>{profile.priority_level}</dd>
                </div>
                <div>
                  <dt>Compare group</dt>
                  <dd>{profile.compare_group_key ?? "-"}</dd>
                </div>
                <div>
                  <dt>Hero candidate</dt>
                  <dd>{profile.hero_candidate ? "Yes" : "No"}</dd>
                </div>
                <div>
                  <dt>Available units</dt>
                  <dd>{profile.stock_units_available}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </details>

      <details className="field-details">
        <summary className="field-summary fold-summary">
          <span>Jobs</span>
          <span className="chip accent">{snapshot.jobs.length}</span>
        </summary>
        <div className="content-list">
          {snapshot.jobs.length === 0 ? (
            <p className="empty">No content jobs yet.</p>
          ) : (
            snapshot.jobs.slice(0, 30).map((job) => (
              <article key={job.id} className="content-list-card">
                <div className="record-header">
                  <div>
                    <h4 className="record-title">{job.title}</h4>
                    <p className="record-subtitle mono">{job.template_code ?? "-"}</p>
                  </div>
                  <div className="chip-row">
                    <span className={`chip ${statusTone(job.status)}`}>{toLabel(job.status)}</span>
                    <span className="chip">{job.engine}</span>
                    <span className="chip">{job.priority}</span>
                  </div>
                </div>
                <dl className="record-meta-grid">
                  <div>
                    <dt>Product</dt>
                    <dd>{job.product_title ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>External status</dt>
                    <dd>{job.external_status ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Started</dt>
                    <dd>{formatDate(job.started_at)}</dd>
                  </div>
                  <div>
                    <dt>Completed</dt>
                    <dd>{formatDate(job.completed_at)}</dd>
                  </div>
                </dl>
                {job.error_message ? <p className="record-note">{job.error_message}</p> : null}
              </article>
            ))
          )}
        </div>
      </details>

      <details className="field-details">
        <summary className="field-summary fold-summary">
          <span>Outputs</span>
          <span className="chip accent">{snapshot.outputs.length}</span>
        </summary>
        <div className="content-list">
          {snapshot.outputs.length === 0 ? (
            <p className="empty">No generated outputs yet.</p>
          ) : (
            snapshot.outputs.slice(0, 24).map((output) => (
              <article key={output.id} className="content-list-card">
                <div className="record-header">
                  <div>
                    <h4 className="record-title">{output.title ?? output.product_title ?? `Output #${output.id}`}</h4>
                    <p className="record-subtitle mono">{output.template_code ?? "-"}</p>
                  </div>
                  <div className="chip-row">
                    <span className={`chip ${statusTone(output.review_status)}`}>{toLabel(output.review_status)}</span>
                    {output.asset_url ? (
                      <a href={output.asset_url} target="_blank" rel="noreferrer" className="chip accent">
                        Open asset
                      </a>
                    ) : null}
                  </div>
                </div>
                {output.review_notes ? <p className="record-note">{output.review_notes}</p> : null}
              </article>
            ))
          )}
        </div>
      </details>

      <details className="field-details">
        <summary className="field-summary fold-summary">
          <span>Publications</span>
          <span className="chip accent">{snapshot.publications.length}</span>
        </summary>
        <div className="content-list">
          {snapshot.publications.length === 0 ? (
            <p className="empty">No publication records yet.</p>
          ) : (
            snapshot.publications.slice(0, 24).map((publication) => (
              <article key={publication.id} className="content-list-card">
                <div className="record-header">
                  <div>
                    <h4 className="record-title">{publication.product_title ?? publication.template_code ?? `Publication #${publication.id}`}</h4>
                    <p className="record-subtitle">{publication.target_account ?? "-"}</p>
                  </div>
                  <div className="chip-row">
                    <span className={`chip ${statusTone(publication.status)}`}>{toLabel(publication.status)}</span>
                    {publication.boost_candidate ? <span className="chip warn">boost candidate</span> : null}
                    {publication.boosted ? <span className="chip good">boosted</span> : null}
                  </div>
                </div>
                <dl className="record-meta-grid">
                  <div>
                    <dt>Channel</dt>
                    <dd>{publication.channel}</dd>
                  </div>
                  <div>
                    <dt>Published</dt>
                    <dd>{formatDate(publication.published_at)}</dd>
                  </div>
                  <div>
                    <dt>Post ID</dt>
                    <dd className="mono">{formatNullable(publication.platform_post_id)}</dd>
                  </div>
                  <div>
                    <dt>URL</dt>
                    <dd>{publication.published_url ? <a href={publication.published_url} target="_blank" rel="noreferrer">Open post</a> : "-"}</dd>
                  </div>
                </dl>
              </article>
            ))
          )}
        </div>
      </details>

      <details className="field-details">
        <summary className="field-summary fold-summary">
          <span>Assets</span>
          <span className="chip accent">{snapshot.assets.length}</span>
        </summary>
        <div className="content-list">
          {snapshot.assets.length === 0 ? (
            <p className="empty">No media assets yet.</p>
          ) : (
            snapshot.assets.slice(0, 30).map((asset) => (
              <article key={asset.id} className="content-list-card">
                <div className="record-header">
                  <div>
                    <h4 className="record-title">{asset.title ?? asset.product_title ?? `Asset #${asset.id}`}</h4>
                    <p className="record-subtitle mono">{asset.storage_url}</p>
                  </div>
                  <div className="chip-row">
                    <span className={`chip ${statusTone(asset.status)}`}>{asset.status}</span>
                    <span className="chip">{asset.asset_type}</span>
                    <span className="chip">{asset.source_kind}</span>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </details>
    </div>
  );
}
