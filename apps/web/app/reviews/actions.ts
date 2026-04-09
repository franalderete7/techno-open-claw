"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getConversationReviewCandidates, runConversationReview } from "../../lib/api";

function buildNotice(result: Awaited<ReturnType<typeof runConversationReview>>) {
  switch (result.status) {
    case "completed":
      return null;
    case "busy":
      return "Ya hay una revisión corriendo.";
    case "disabled":
      return "La revisión automática por cron está apagada. Para analizar desde esta pantalla no hace falta ese flag; si ves esto, revisá que el API esté bien configurado.";
    case "skipped":
      if (result.reason === "not_enough_unreviewed_conversations") {
        return `Todavía no hay suficientes conversaciones elegibles. Disponibles: ${result.available ?? 0}.`;
      }
      return "No encontré conversaciones elegibles para revisar.";
    default:
      return "No pude iniciar la revisión.";
  }
}

export async function runAnalyzeFirstNAction(formData: FormData) {
  const parsed = Number(formData.get("n"));
  const n = Math.min(50, Math.max(1, Number.isFinite(parsed) && parsed > 0 ? parsed : 10));
  const { items } = await getConversationReviewCandidates(n);
  const ids = items.map((item) => item.conversation_id);

  if (ids.length === 0) {
    redirect(`/reviews?notice=${encodeURIComponent("No hay conversaciones elegibles en cola.")}`);
  }

  const result = await runConversationReview({
    force: true,
    conversation_ids: ids,
  });

  revalidatePath("/reviews");

  if (result.status === "completed") {
    redirect(`/reviews?batch=${result.batchId}&ok=1`);
  }

  redirect(`/reviews?notice=${encodeURIComponent(buildNotice(result) || "No pude iniciar la revisión.")}`);
}

export async function runSelectedReviewAction(formData: FormData) {
  const selectedIds = formData
    .getAll("conversation_id")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (selectedIds.length === 0) {
    redirect("/reviews?notice=Seleccioná%20al%20menos%20una%20conversaci%C3%B3n.");
  }

  const result = await runConversationReview({
    force: true,
    conversation_ids: selectedIds,
  });

  revalidatePath("/reviews");

  if (result.status === "completed") {
    redirect(`/reviews?batch=${result.batchId}&ok=1`);
  }

  redirect(`/reviews?notice=${encodeURIComponent(buildNotice(result) || "No pude iniciar la revisión seleccionada.")}`);
}
