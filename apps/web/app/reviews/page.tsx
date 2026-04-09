import Link from "next/link";
import {
  getConversationReviewBatch,
  getConversationReviewBatches,
  getConversationReviewCandidates,
  type ConversationReviewBatchRecord,
} from "../../lib/api";
import { runQueuedReviewAction, runSelectedReviewAction } from "./actions";

type ReviewsPageProps = {
  searchParams?: Promise<{
    batch?: string;
    notice?: string;
  }>;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatScore(value: number | null | undefined) {
  return value == null ? "—" : `${Math.max(0, Math.min(100, Number(value)))} / 100`;
}

function scoreTone(value: number | null | undefined) {
  if (value == null) return "";
  if (value >= 85) return "good";
  if (value >= 60) return "accent";
  return "warn";
}

function pickSelectedBatchId(searchBatch: string | undefined, batches: ConversationReviewBatchRecord[]) {
  const parsed = Number(searchBatch);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return batches[0]?.id ?? null;
}

export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const notice = resolvedSearchParams.notice?.trim() || null;
  let batches = [] as Awaited<ReturnType<typeof getConversationReviewBatches>>["items"];
  let candidates = [] as Awaited<ReturnType<typeof getConversationReviewCandidates>>["items"];
  let selectedBatch = null as Awaited<ReturnType<typeof getConversationReviewBatch>>["batch"] | null;
  let selectedItems = [] as Awaited<ReturnType<typeof getConversationReviewBatch>>["items"];
  let error: string | null = null;

  try {
    const [batchResponse, candidateResponse] = await Promise.all([
      getConversationReviewBatches(24),
      getConversationReviewCandidates(30),
    ]);
    batches = batchResponse.items;
    candidates = candidateResponse.items;

    const selectedBatchId = pickSelectedBatchId(resolvedSearchParams.batch, batches);
    if (selectedBatchId) {
      const detail = await getConversationReviewBatch(selectedBatchId);
      selectedBatch = detail.batch;
      selectedItems = detail.items;
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load conversation reviews";
  }

  const summary = (selectedBatch?.summary_json ?? {}) as {
    top_issue_types?: Array<{ type?: string; count?: number }>;
    recommended_changes?: Array<{ priority?: string; area?: string; change?: string; reason?: string }>;
    urgent_findings?: string[];
    notable_wins?: string[];
    conversations_with_issues?: number;
  };
  const topIssueTypes = Array.isArray(summary.top_issue_types) ? summary.top_issue_types : [];
  const recommendedChanges = Array.isArray(summary.recommended_changes) ? summary.recommended_changes : [];
  const urgentFindings = Array.isArray(summary.urgent_findings) ? summary.urgent_findings : [];
  const notableWins = Array.isArray(summary.notable_wins) ? summary.notable_wins : [];

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Reviews</span>
        <h2 className="hero-title">Conversation QA</h2>
        <p className="hero-copy">
          Stored reviewer batches live here now. You can inspect past analyses, see the saved summaries from Postgres, and manually launch a batch from selected conversations.
        </p>
        <div className="chip-row">
          <span className="chip accent">{batches.length} batches</span>
          <span className="chip">{candidates.length} candidatas</span>
          {selectedBatch ? <span className={`chip ${scoreTone(selectedBatch.overall_score)}`}>Score {formatScore(selectedBatch.overall_score)}</span> : null}
        </div>
        {notice ? <p className="empty">{notice}</p> : null}
        {error ? <p className="empty">{error}</p> : null}
      </section>

      <section className="reviews-layout">
        <div className="page-stack">
          <section className="panel reviews-action-panel">
            <div className="panel-header">
              <div>
                <h3 className="panel-title">Run reviewer</h3>
                <p className="panel-copy">Podés disparar el siguiente lote automático de 10 o elegir conversaciones puntuales.</p>
              </div>
            </div>
            <div className="reviews-action-grid">
              <form action={runQueuedReviewAction} className="reviews-action-card">
                <p className="catalog-kicker">Automático</p>
                <h4 className="record-title">Revisar próximas 10</h4>
                <p className="muted">Usa la misma lógica del cron: toma el próximo lote elegible y guarda el resumen en la base.</p>
                <button type="submit" className="chip action-link accent">
                  Analizar siguiente lote
                </button>
              </form>

              <form action={runSelectedReviewAction} className="reviews-action-card">
                <div className="reviews-candidate-head">
                  <div>
                    <p className="catalog-kicker">Manual</p>
                    <h4 className="record-title">Elegir conversaciones</h4>
                  </div>
                  <button type="submit" className="chip action-link accent">
                    Analizar selección
                  </button>
                </div>
                <div className="reviews-candidate-list">
                  {candidates.length === 0 ? <p className="empty">No hay conversaciones elegibles pendientes.</p> : null}
                  {candidates.map((candidate) => (
                    <label key={candidate.conversation_id} className="reviews-candidate-card">
                      <input type="checkbox" name="conversation_id" value={candidate.conversation_id} />
                      <div className="reviews-candidate-body">
                        <div className="reviews-candidate-title">
                          <strong>{candidate.customer_name}</strong>
                          <span className="chip mono">#{candidate.conversation_id}</span>
                        </div>
                        <p className="muted">
                          {candidate.customer_phone ?? "Sin teléfono"} · {candidate.inbound_count} inbound · {candidate.outbound_count} outbound · {formatDateTime(candidate.last_message_at)}
                        </p>
                        <p className="reviews-candidate-snippet">
                          <strong>Cliente:</strong> {candidate.last_customer_message || "—"}
                        </p>
                        <p className="reviews-candidate-snippet">
                          <strong>Bot:</strong> {candidate.last_bot_message || "—"}
                        </p>
                        <div className="chip-row">
                          {candidate.route_keys_seen.slice(0, 3).map((routeKey) => (
                            <span key={routeKey} className="chip">
                              {routeKey}
                            </span>
                          ))}
                          {candidate.auto_flags.slice(0, 3).map((flag) => (
                            <span key={flag} className="chip warn">
                              {flag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </form>
            </div>
          </section>

          <section className="panel reviews-detail-panel">
            <div className="panel-header">
              <div>
                <h3 className="panel-title">Batch detail</h3>
                <p className="panel-copy">El resumen y los hallazgos se leen desde `conversation_review_batches` y `conversation_review_items`.</p>
              </div>
            </div>

            {!selectedBatch ? (
              <p className="empty">Todavía no hay un batch seleccionado.</p>
            ) : (
              <div className="page-stack">
                <div className="reviews-batch-header">
                  <div>
                    <p className="catalog-kicker">Batch #{selectedBatch.id}</p>
                    <h4 className="record-title">Estado {selectedBatch.status}</h4>
                    <p className="muted">
                      {selectedBatch.triggered_by} · {selectedBatch.model_name ?? "sin modelo"} · {formatDateTime(selectedBatch.reviewed_at ?? selectedBatch.created_at)}
                    </p>
                  </div>
                  <div className="chip-row">
                    <span className={`chip ${scoreTone(selectedBatch.overall_score)}`}>{formatScore(selectedBatch.overall_score)}</span>
                    <span className="chip">{selectedBatch.conversation_count} conversaciones</span>
                    <span className="chip">{summary.conversations_with_issues ?? selectedItems.length} con issues</span>
                  </div>
                </div>

                <div className="reviews-summary-grid">
                  <article className="reviews-summary-card">
                    <h4 className="panel-title">Top issues</h4>
                    <div className="chip-row">
                      {topIssueTypes.slice(0, 6).map((item, index) => (
                        <span key={`${item.type}-${index}`} className="chip warn">
                          {item.type ?? "issue"} · {item.count ?? 0}
                        </span>
                      ))}
                      {topIssueTypes.length === 0 ? <span className="muted">Sin issues repetidos.</span> : null}
                    </div>
                  </article>

                  <article className="reviews-summary-card">
                    <h4 className="panel-title">Urgent findings</h4>
                    <ul className="reviews-list">
                      {urgentFindings.slice(0, 5).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                      {urgentFindings.length === 0 ? <li>Sin hallazgos urgentes.</li> : null}
                    </ul>
                  </article>
                </div>

                <article className="reviews-summary-card">
                  <h4 className="panel-title">Recommended changes</h4>
                  <div className="reviews-recommendation-list">
                    {recommendedChanges.slice(0, 6).map((change, index) => (
                      <div key={`${change.area}-${index}`} className="reviews-recommendation-card">
                        <div className="chip-row">
                          <span className="chip accent">{change.priority ?? "medium"}</span>
                          <span className="chip">{change.area ?? "unknown"}</span>
                        </div>
                        <strong>{change.change ?? "Sin cambio sugerido"}</strong>
                        {change.reason ? <p className="muted">{change.reason}</p> : null}
                      </div>
                    ))}
                    {recommendedChanges.length === 0 ? <p className="empty">El reviewer no devolvió cambios sugeridos en este batch.</p> : null}
                  </div>
                </article>

                {notableWins.length > 0 ? (
                  <article className="reviews-summary-card">
                    <h4 className="panel-title">Notable wins</h4>
                    <ul className="reviews-list">
                      {notableWins.slice(0, 5).map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </article>
                ) : null}

                {selectedBatch.summary_markdown ? (
                  <article className="reviews-summary-card">
                    <h4 className="panel-title">Saved summary</h4>
                    <pre className="json-block reviews-markdown">{selectedBatch.summary_markdown}</pre>
                  </article>
                ) : null}

                <article className="reviews-summary-card">
                  <h4 className="panel-title">Conversation findings</h4>
                  <div className="reviews-finding-list">
                    {selectedItems.length === 0 ? <p className="empty">Este batch no tiene items guardados.</p> : null}
                    {selectedItems.map((item) => (
                      <div key={item.id} className="reviews-finding-card">
                        <div className="reviews-finding-head">
                          <div>
                            <strong>Conversation #{item.conversation_id}</strong>
                            <p className="muted">
                              {item.verdict ?? "sin verdict"} · {item.root_cause_area ?? "sin root cause"} · {item.severity ?? "sin severity"}
                            </p>
                          </div>
                          <span className={`chip ${scoreTone(item.score)}`}>{formatScore(item.score)}</span>
                        </div>
                        {item.what_went_wrong ? <p>{item.what_went_wrong}</p> : null}
                        {item.suggested_fix ? <p className="muted"><strong>Fix:</strong> {item.suggested_fix}</p> : null}
                        <div className="chip-row">
                          {(Array.isArray(item.issue_types) ? item.issue_types : []).map((issueType) => (
                            <span key={issueType} className="chip warn">
                              {issueType}
                            </span>
                          ))}
                        </div>
                        {Array.isArray(item.evidence) && item.evidence.length > 0 ? (
                          <div className="reviews-evidence-list">
                            {item.evidence.slice(0, 3).map((evidence, index) => (
                              <blockquote key={`${evidence.message_id ?? "quote"}-${index}`} className="reviews-evidence-quote">
                                {evidence.quote ?? "Sin cita"}
                              </blockquote>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </article>
              </div>
            )}
          </section>
        </div>

        <aside className="page-stack">
          <section className="panel reviews-batch-list-panel">
            <div className="panel-header">
              <div>
                <h3 className="panel-title">Recent batches</h3>
                <p className="panel-copy">Cada fila apunta a un batch guardado en la base.</p>
              </div>
            </div>
            <div className="reviews-batch-list">
              {batches.length === 0 ? <p className="empty">Todavía no hay batches guardados.</p> : null}
              {batches.map((batch) => (
                <Link
                  key={batch.id}
                  href={`/reviews?batch=${batch.id}`}
                  className={`reviews-batch-list-item ${selectedBatch?.id === batch.id ? "is-active" : ""}`}
                >
                  <div className="reviews-batch-list-head">
                    <strong>Batch #{batch.id}</strong>
                    <span className={`chip ${scoreTone(batch.overall_score)}`}>{formatScore(batch.overall_score)}</span>
                  </div>
                  <p className="muted">
                    {batch.triggered_by} · {batch.conversation_count} conversaciones · {formatDateTime(batch.reviewed_at ?? batch.created_at)}
                  </p>
                  <div className="chip-row">
                    <span className="chip">{batch.status}</span>
                    {batch.telegram_delivered_at ? <span className="chip good">telegram</span> : <span className="chip">sin telegram</span>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
