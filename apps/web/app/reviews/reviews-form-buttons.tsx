"use client";

import { useFormStatus } from "react-dom";

export function ReviewsPrimaryAnalyzeButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="reviews-analyze-button" disabled={pending} aria-busy={pending}>
      {pending ? "Generando revisión…" : "Analizar con el modelo revisor"}
    </button>
  );
}

export function ReviewsManualSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="chip action-link accent" disabled={pending}>
      {pending ? "Enviando…" : "Analizar selección"}
    </button>
  );
}
