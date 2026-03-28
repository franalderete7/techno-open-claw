import Link from "next/link";
import type { MetaAdsOverviewResponse } from "../../lib/api";

type AdsExplorerProps = {
  snapshot: MetaAdsOverviewResponse;
};

function asNumber(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function formatNumber(value: string | number | null | undefined) {
  const numeric = asNumber(value);
  if (numeric == null) return "-";
  return new Intl.NumberFormat("es-AR").format(numeric);
}

function formatMoney(value: string | number | null | undefined, currency = "ARS") {
  const numeric = asNumber(value);
  if (numeric == null) return "-";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(numeric);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatText(value: string | number | null | undefined) {
  if (value == null || value === "") return "-";
  return String(value);
}

function buildInstagramAccounts(snapshot: MetaAdsOverviewResponse) {
  const accounts = new Map<string, { id: string; username: string | null; source: string }>();

  for (const account of snapshot.ads_manager.instagram_accounts) {
    accounts.set(account.id, {
      id: account.id,
      username: account.username ?? null,
      source: "Ads Manager",
    });
  }

  for (const page of snapshot.business_suite.pages) {
    const ig = page.instagram_business_account;
    if (!ig?.id) {
      continue;
    }

    if (!accounts.has(ig.id)) {
      accounts.set(ig.id, {
        id: ig.id,
        username: ig.username ?? null,
        source: "Business Suite",
      });
    }
  }

  return Array.from(accounts.values());
}

function statusTone(status: string | null | undefined) {
  const normalized = (status ?? "").toLowerCase();
  if (normalized.includes("active")) return "good";
  if (normalized.includes("paused")) return "warn";
  if (normalized.includes("deleted") || normalized.includes("archived")) return "danger";
  return "";
}

export function AdsExplorer({ snapshot }: AdsExplorerProps) {
  const spendCurrency = snapshot.ads_manager.insights?.account_currency ?? snapshot.ads_manager.account?.currency ?? "ARS";
  const instagramAccounts = buildInstagramAccounts(snapshot);
  const pagesWithInstagram = snapshot.business_suite.pages.filter((page) => Boolean(page.instagram_business_account?.id));

  return (
    <div className="page-stack">
      <section className="stats-grid">
        <article className="stat-card">
          <span className="stat-label">Spend {snapshot.ads_manager.insights_window_days}d</span>
          <strong className="stat-value">
            {formatMoney(snapshot.ads_manager.insights?.spend, spendCurrency)}
          </strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Campaigns</span>
          <strong className="stat-value">{snapshot.ads_manager.campaigns.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Ad Sets</span>
          <strong className="stat-value">{snapshot.ads_manager.ad_sets.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Ads</span>
          <strong className="stat-value">{snapshot.ads_manager.ads.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Business Pages</span>
          <strong className="stat-value">{snapshot.business_suite.pages.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Instagram Accounts</span>
          <strong className="stat-value">{instagramAccounts.length}</strong>
        </article>
      </section>

      <section className="split-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">Connection</h3>
              <p className="panel-copy">What is configured right now for live Meta reads.</p>
            </div>
          </div>

          <div className="chip-row">
            <span className={`chip ${snapshot.configured.access_token ? "good" : "danger"}`}>Access token</span>
            <span className={`chip ${snapshot.configured.ad_account_id ? "good" : "danger"}`}>Ad account</span>
            <span className={`chip ${snapshot.configured.business_id ? "good" : "warn"}`}>Business ID</span>
            <span className={`chip ${snapshot.configured.app_id ? "good" : "warn"}`}>App ID</span>
            <span className={`chip ${snapshot.configured.app_secret ? "good" : "warn"}`}>App secret</span>
            <span className="chip accent mono">{snapshot.configured.api_version}</span>
          </div>

          {(snapshot.configured.missing_required.length > 0 || snapshot.configured.missing_optional.length > 0) && (
            <div className="record-note ads-note">
              {snapshot.configured.missing_required.length > 0 ? (
                <p className="ads-note-line">
                  Missing required: <span className="mono">{snapshot.configured.missing_required.join(", ")}</span>
                </p>
              ) : null}
              {snapshot.configured.missing_optional.length > 0 ? (
                <p className="ads-note-line">
                  Missing optional: <span className="mono">{snapshot.configured.missing_optional.join(", ")}</span>
                </p>
              ) : null}
            </div>
          )}

          <dl className="record-meta-grid">
            <div>
              <dt>Fetched</dt>
              <dd>{formatDate(snapshot.fetched_at)}</dd>
            </div>
            <div>
              <dt>Base URL</dt>
              <dd className="mono">{snapshot.configured.base_url}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">Ads Manager</h3>
              <p className="panel-copy">Live snapshot from the ad account and its marketing objects.</p>
            </div>
          </div>

          <dl className="record-meta-grid">
            <div>
              <dt>Account</dt>
              <dd>{formatText(snapshot.ads_manager.account?.name)}</dd>
            </div>
            <div>
              <dt>Ad Account ID</dt>
              <dd className="mono">{formatText(snapshot.ads_manager.account?.account_id ?? snapshot.ads_manager.account?.id)}</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>{formatText(snapshot.ads_manager.account?.currency)}</dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>{formatText(snapshot.ads_manager.account?.timezone_name)}</dd>
            </div>
            <div>
              <dt>Impressions</dt>
              <dd>{formatNumber(snapshot.ads_manager.insights?.impressions)}</dd>
            </div>
            <div>
              <dt>Clicks</dt>
              <dd>{formatNumber(snapshot.ads_manager.insights?.clicks)}</dd>
            </div>
            <div>
              <dt>Reach</dt>
              <dd>{formatNumber(snapshot.ads_manager.insights?.reach)}</dd>
            </div>
            <div>
              <dt>CTR</dt>
              <dd>{formatText(snapshot.ads_manager.insights?.ctr)}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="split-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">Business Suite</h3>
              <p className="panel-copy">Business-level assets tied to the configured business.</p>
            </div>
          </div>

          <dl className="record-meta-grid">
            <div>
              <dt>Business</dt>
              <dd>{formatText(snapshot.business_suite.business?.name)}</dd>
            </div>
            <div>
              <dt>Business ID</dt>
              <dd className="mono">{formatText(snapshot.business_suite.business?.id)}</dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>{formatText(snapshot.business_suite.business?.verification_status)}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(snapshot.business_suite.business?.created_time)}</dd>
            </div>
            <div>
              <dt>Owned Ad Accounts</dt>
              <dd>{snapshot.business_suite.owned_ad_accounts.length}</dd>
            </div>
            <div>
              <dt>Pages With IG</dt>
              <dd>{pagesWithInstagram.length}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">Warnings</h3>
              <p className="panel-copy">Partial failures or missing pieces while reading Meta.</p>
            </div>
          </div>

          {snapshot.warnings.length === 0 ? (
            <p className="empty">No warnings. The snapshot loaded cleanly.</p>
          ) : (
            <ul className="ads-warning-list">
              {snapshot.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <article className="table-card">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Business Pages</h3>
            <p className="panel-copy">Pages owned by the business plus linked Instagram accounts where available.</p>
          </div>
        </div>

        {snapshot.business_suite.pages.length === 0 ? (
          <p className="empty">No business pages were returned.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Instagram</th>
                  <th>Links</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.business_suite.pages.map((page) => (
                  <tr key={page.id}>
                    <td>
                      <div className="value-stack">
                        <strong>{formatText(page.name)}</strong>
                        <span className="mono">{page.id}</span>
                      </div>
                    </td>
                    <td>
                      {page.instagram_business_account?.id ? (
                        <div className="value-stack">
                          <strong>@{page.instagram_business_account.username ?? "-"}</strong>
                          <span className="mono">{page.instagram_business_account.id}</span>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      {page.link ? (
                        <Link href={page.link} target="_blank" rel="noreferrer" className="chip action-link">
                          Open page
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="table-card">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Owned Ad Accounts</h3>
            <p className="panel-copy">Ad accounts returned from the business side, not the current account context only.</p>
          </div>
        </div>

        {snapshot.business_suite.owned_ad_accounts.length === 0 ? (
          <p className="empty">No owned ad accounts were returned.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Account ID</th>
                  <th>Status</th>
                  <th>Currency</th>
                  <th>Timezone</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.business_suite.owned_ad_accounts.map((account) => (
                  <tr key={account.id}>
                    <td>{formatText(account.name)}</td>
                    <td className="mono">{formatText(account.account_id ?? account.id)}</td>
                    <td>{formatText(account.account_status)}</td>
                    <td>{formatText(account.currency)}</td>
                    <td>{formatText(account.timezone_name)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="table-card">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Campaigns</h3>
            <p className="panel-copy">Campaign-level objects from the configured ad account.</p>
          </div>
        </div>

        {snapshot.ads_manager.campaigns.length === 0 ? (
          <p className="empty">No campaigns were returned.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Objective</th>
                  <th>Budget</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.ads_manager.campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>
                      <div className="value-stack">
                        <strong>{formatText(campaign.name)}</strong>
                        <span className="mono">{campaign.id}</span>
                      </div>
                    </td>
                    <td>
                      <div className="chip-row">
                        <span className={`chip ${statusTone(campaign.status)}`}>{formatText(campaign.status)}</span>
                        <span className={`chip ${statusTone(campaign.effective_status)}`}>
                          {formatText(campaign.effective_status)}
                        </span>
                      </div>
                    </td>
                    <td>{formatText(campaign.objective)}</td>
                    <td>{formatMoney(campaign.daily_budget ?? campaign.lifetime_budget, spendCurrency)}</td>
                    <td>{formatDate(campaign.updated_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="table-card">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Ad Sets</h3>
            <p className="panel-copy">Delivery and optimization layer under each campaign.</p>
          </div>
        </div>

        {snapshot.ads_manager.ad_sets.length === 0 ? (
          <p className="empty">No ad sets were returned.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Campaign</th>
                  <th>Optimization</th>
                  <th>Budget</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.ads_manager.ad_sets.map((adSet) => (
                  <tr key={adSet.id}>
                    <td>
                      <div className="value-stack">
                        <strong>{formatText(adSet.name)}</strong>
                        <span className="mono">{adSet.id}</span>
                      </div>
                    </td>
                    <td>
                      <div className="chip-row">
                        <span className={`chip ${statusTone(adSet.status)}`}>{formatText(adSet.status)}</span>
                        <span className={`chip ${statusTone(adSet.effective_status)}`}>
                          {formatText(adSet.effective_status)}
                        </span>
                      </div>
                    </td>
                    <td className="mono">{formatText(adSet.campaign_id)}</td>
                    <td>{formatText(adSet.optimization_goal ?? adSet.billing_event)}</td>
                    <td>{formatMoney(adSet.daily_budget ?? adSet.lifetime_budget, spendCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="table-card">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Ads</h3>
            <p className="panel-copy">Actual ad objects and linked creatives where Meta returns them.</p>
          </div>
        </div>

        {snapshot.ads_manager.ads.length === 0 ? (
          <p className="empty">No ads were returned.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ad</th>
                  <th>Status</th>
                  <th>Campaign / Ad Set</th>
                  <th>Creative</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.ads_manager.ads.map((ad) => (
                  <tr key={ad.id}>
                    <td>
                      <div className="value-stack">
                        <strong>{formatText(ad.name)}</strong>
                        <span className="mono">{ad.id}</span>
                      </div>
                    </td>
                    <td>
                      <div className="chip-row">
                        <span className={`chip ${statusTone(ad.status)}`}>{formatText(ad.status)}</span>
                        <span className={`chip ${statusTone(ad.effective_status)}`}>{formatText(ad.effective_status)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="value-stack">
                        <span className="mono">campaign {formatText(ad.campaign_id)}</span>
                        <span className="mono">ad set {formatText(ad.adset_id)}</span>
                      </div>
                    </td>
                    <td>
                      {ad.creative?.id ? (
                        <div className="value-stack">
                          <strong>{formatText(ad.creative.name)}</strong>
                          <span className="mono">{ad.creative.id}</span>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{formatDate(ad.updated_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}
