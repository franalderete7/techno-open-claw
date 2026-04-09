import Link from "next/link";
import {
  getConversationReviewBatch,
  getConversationReviewBatches,
  getConversationReviewCandidates,
  type ConversationReviewBatchRecord,
} from "../../lib/api";
import { runAnalyzeFirstNAction, runSelectedReviewAction } from "./actions";

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

function clipSnippet(value: string | null | undefined, max = 140) {
  const text = String(value ?? "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
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
      getConversationReviewCandidates(80),
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
        <p className="hero-copy hero-copy-tight">
          Elegís cuántas conversaciones <strong>pendientes de revisar</strong> querés analizar. Un modelo de IA lee los mensajes, puntúa y devuelve resumen, problemas y sugerencias. El resultado aparece abajo y en la lista de la derecha.
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
          <section className="panel reviews-cta-panel">
            <h3 className="panel-title reviews-cta-heading">Generar revisión con IA</h3>
            <p className="reviews-cta-lead muted">
              Solo conversaciones que todavía no tuvieron un batch de QA (orden: las más viejas en cola primero, para ir limpiando backlog).
            </p>
            <form action={runAnalyzeFirstNAction} className="reviews-cta-form">
              <label className="reviews-cta-field">
                <span className="reviews-cta-label">Cantidad de conversaciones</span>
                <select name="n" className="reviews-toolbar-select reviews-cta-select" defaultValue={10} aria-label="Cantidad de conversaciones a analizar">
                  {[5, 10, 15, 20, 30, 40, 50].map((n) => (
                    <option key={n} value={n}>
                      {n} conversaciones
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="reviews-analyze-button">
                Analizar con el modelo revisor
              </button>
            </form>
            <details className="reviews-storage-details">
              <summary>¿Dónde se guarda el resultado?</summary>
              <p className="muted reviews-storage-body">
                En la base de datos: tablas <code className="mono-inline">conversation_review_batches</code> (resumen del lote) y{" "}
                <code className="mono-inline">conversation_review_items</code> (detalle por conversación).
              </p>
            </details>
          </section>

          <details className="panel reviews-manual-panel">
            <summary className="reviews-manual-summary">Selección manual y lista</summary>
            <form action={runSelectedReviewAction} className="reviews-manual-form">
              <div className="reviews-candidate-head">
                <p className="catalog-kicker">Marcá conversaciones y enviá</p>
                <button type="submit" className="chip action-link accent">
                  Analizar selección
                </button>
              </div>
              <div className="reviews-candidate-list">
                {candidates.length === 0 ? <p className="empty">No hay conversaciones elegibles pendientes.</p> : null}
                {candidates.map((candidate) => (
                  <label key={candidate.conversation_id} className="reviews-candidate-card reviews-candidate-card-compact">
                    <input type="checkbox" name="conversation_id" value={candidate.conversation_id} />
                    <div className="reviews-candidate-body">
                      <div className="reviews-candidate-title">
                        <strong>{candidate.customer_name}</strong>
                        <span className="chip mono">#{candidate.conversation_id}</span>
                      </div>
                      <p className="reviews-candidate-meta muted">
                        {candidate.customer_phone ?? "—"} · {candidate.inbound_count}/{candidate.outbound_count} · {formatDateTime(candidate.last_message_at)}
                      </p>
                      <p className="reviews-candidate-preview">
                        <span className="reviews-candidate-preview-label">C:</span> {clipSnippet(candidate.last_customer_message, 120)}
                      </p>
                      <details className="reviews-candidate-thread">
                        <summary>Ver mensajes</summary>
                        <div className="reviews-candidate-thread-body">
                          <p className="reviews-candidate-snippet">
                            <strong>Cliente:</strong> {candidate.last_customer_message || "—"}
                          </p>
                          <p className="reviews-candidate-snippet">
                            <strong>Bot:</strong> {candidate.last_bot_message || "—"}
                          </p>
                        </div>
                      </details>
                      <div className="chip-row reviews-candidate-chips">
                        {candidate.route_keys_seen.slice(0, 2).map((routeKey) => (
                          <span key={routeKey} className="chip">
                            {routeKey}
                          </span>
                        ))}
                        {candidate.auto_flags.slice(0, 2).map((flag) => (
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
          </details>

          <section className="panel reviews-detail-panel">
            <div className="panel-header">
              <div>
                <h3 className="panel-title">Resultado del batch</h3>
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
