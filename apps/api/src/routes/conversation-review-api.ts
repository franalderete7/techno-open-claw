import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { query } from "../db.js";
import { getConversationReviewCandidates, runConversationReviewCycle } from "../conversation-reviewer.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const runBodySchema = z.object({
  force: z.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  conversation_ids: z.array(z.coerce.number().int().positive()).max(50).optional().default([]),
});

const batchParamsSchema = z.object({
  batchId: z.coerce.number().int().positive(),
});

export const conversationReviewApiRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/conversation-reviews/candidates", async (request) => {
    const params = listQuerySchema.parse(request.query);
    const items = await getConversationReviewCandidates(params.limit);
    return { items };
  });

  app.get("/v1/conversation-reviews", async (request) => {
    const params = listQuerySchema.parse(request.query);
    const rows = await query(
      `
        select
          id,
          status,
          triggered_by,
          workflow_version,
          model_name,
          repo_dir,
          repo_commit_sha,
          conversation_count,
          conversation_ids,
          overall_score,
          failure_message,
          telegram_chat_ids,
          telegram_delivered_at,
          created_at,
          reviewed_at
        from public.conversation_review_batches
        order by created_at desc, id desc
        limit $1
      `,
      [params.limit]
    );

    return { items: rows };
  });

  app.get("/v1/conversation-reviews/:batchId", async (request, reply) => {
    const { batchId } = batchParamsSchema.parse(request.params);
    const batchRows = await query(
      `
        select
          id,
          status,
          triggered_by,
          workflow_version,
          model_name,
          repo_dir,
          repo_commit_sha,
          conversation_count,
          conversation_ids,
          workflow_context,
          summary_markdown,
          summary_json,
          overall_score,
          failure_message,
          telegram_chat_ids,
          telegram_delivered_at,
          created_at,
          reviewed_at
        from public.conversation_review_batches
        where id = $1
        limit 1
      `,
      [batchId]
    );

    const batch = batchRows[0];
    if (!batch) {
      return reply.code(404).send({ error: "Conversation review batch not found." });
    }

    const items = await query(
      `
        select
          id,
          batch_id,
          conversation_id,
          score,
          verdict,
          severity,
          issue_types,
          root_cause_area,
          what_went_wrong,
          suggested_fix,
          evidence,
          raw_analysis,
          created_at
        from public.conversation_review_items
        where batch_id = $1
        order by score asc nulls last, id asc
      `,
      [batchId]
    );

    return {
      batch,
      items,
    };
  });

  app.post("/v1/conversation-reviews/run", async (request) => {
    const body = runBodySchema.parse(request.body ?? {});
    return runConversationReviewCycle(app.log, {
      triggeredBy: body.conversation_ids.length > 0 ? "manual_selection" : "manual_api",
      force: body.force,
      limit: body.limit,
      conversationIds: body.conversation_ids,
    });
  });
};
