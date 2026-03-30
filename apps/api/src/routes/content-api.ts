import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import {
  contentAssetSourceValues,
  contentAssetStatusValues,
  contentAssetTypeValues,
  contentChannelValues,
  contentEngineValues,
  contentFormatValues,
  contentJobStatusValues,
  contentPriorityLevelValues,
  contentPriorityValues,
  contentPublicationStatusValues,
  contentReviewStatusValues,
  contentTierValues,
  createContentAsset,
  createContentJob,
  createContentPublication,
  createPlannedJobsFromSuggestions,
  ensureContentProductProfiles,
  getContentOverview,
  listBrandProfiles,
  listContentJobs,
  listContentOutputs,
  listContentPlannerSuggestions,
  listContentPublications,
  listContentTemplates,
  listMediaAssets,
  listProductContentProfiles,
  runContentJob,
  syncContentJob,
  updateBrandProfile,
  updateContentAsset,
  updateContentJobStatus,
  updateContentOutputReview,
  updateContentPublication,
  updateContentTemplate,
  updateProductContentProfile,
} from "../content-system.js";

const jsonValueSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
);

const contentAssetSchema = z.object({
  product_id: z.coerce.number().int().positive().optional().nullable(),
  brand_key: z.string().trim().optional().nullable(),
  asset_type: z.enum(contentAssetTypeValues),
  source_kind: z.enum(contentAssetSourceValues),
  status: z.enum(contentAssetStatusValues).optional(),
  title: z.string().trim().optional().nullable(),
  storage_url: z.string().trim().min(1),
  mime_type: z.string().trim().optional().nullable(),
  width: z.coerce.number().int().positive().optional().nullable(),
  height: z.coerce.number().int().positive().optional().nullable(),
  duration_ms: z.coerce.number().int().positive().optional().nullable(),
  external_asset_id: z.string().trim().optional().nullable(),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
});

const contentJobSchema = z.object({
  product_id: z.coerce.number().int().positive().optional().nullable(),
  brand_key: z.string().trim().optional().nullable(),
  template_id: z.coerce.number().int().positive().optional().nullable(),
  engine: z.enum(contentEngineValues),
  channel: z.enum(contentChannelValues),
  format: z.enum(contentFormatValues),
  title: z.string().trim().min(1),
  status: z.enum(contentJobStatusValues).optional(),
  priority: z.enum(contentPriorityValues).optional(),
  requested_by: z.string().trim().optional().nullable(),
  input_json: z.record(z.string(), jsonValueSchema).optional(),
});

const publicationSchema = z.object({
  output_id: z.coerce.number().int().positive(),
  channel: z.enum(contentChannelValues),
  target_account: z.string().trim().optional().nullable(),
  platform_post_id: z.string().trim().optional().nullable(),
  published_url: z.string().trim().optional().nullable(),
  status: z.enum(contentPublicationStatusValues).optional(),
  boost_candidate: z.boolean().optional(),
  boosted: z.boolean().optional(),
  published_at: z.string().trim().optional().nullable(),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
});

export const contentApiRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/content/overview", async () => {
    return getContentOverview(pool);
  });

  app.post("/v1/content/bootstrap", async () => {
    const synced = await ensureContentProductProfiles(pool);
    return {
      ok: true,
      synced_profiles: synced,
    };
  });

  app.get("/v1/content/brands", async () => {
    return {
      items: await listBrandProfiles(pool),
    };
  });

  app.patch("/v1/content/brands/:brandKey", async (request) => {
    const params = z.object({
      brandKey: z.string().trim().min(1),
    }).parse(request.params);
    const body = z.object({
      label: z.string().trim().optional(),
      visual_direction: z.string().trim().optional().nullable(),
      theme_json: z.record(z.string(), jsonValueSchema).optional(),
      active: z.boolean().optional(),
    }).parse(request.body);

    return updateBrandProfile(pool, params.brandKey, body);
  });

  app.get("/v1/content/templates", async () => {
    return {
      items: await listContentTemplates(pool),
    };
  });

  app.patch("/v1/content/templates/:templateId", async (request) => {
    const params = z.object({
      templateId: z.coerce.number().int().positive(),
    }).parse(request.params);
    const body = z.object({
      label: z.string().trim().optional(),
      engine: z.enum(contentEngineValues).optional(),
      channel: z.enum(contentChannelValues).optional(),
      format: z.enum(contentFormatValues).optional(),
      description: z.string().trim().optional().nullable(),
      prompt_text: z.string().trim().optional().nullable(),
      definition_json: z.record(z.string(), jsonValueSchema).optional(),
      active: z.boolean().optional(),
    }).parse(request.body);

    return updateContentTemplate(pool, params.templateId, body);
  });

  app.get("/v1/content/product-profiles", async () => {
    return {
      items: await listProductContentProfiles(pool),
    };
  });

  app.patch("/v1/content/product-profiles/:productId", async (request) => {
    const params = z.object({
      productId: z.coerce.number().int().positive(),
    }).parse(request.params);
    const body = z.object({
      brand_key: z.string().trim().optional(),
      tier: z.enum(contentTierValues).optional(),
      priority_level: z.enum(contentPriorityLevelValues).optional(),
      compare_group_key: z.string().trim().optional().nullable(),
      hero_candidate: z.boolean().optional(),
      content_enabled: z.boolean().optional(),
      visual_mode: z.string().trim().optional().nullable(),
      metadata: z.record(z.string(), jsonValueSchema).optional(),
    }).parse(request.body);

    return updateProductContentProfile(pool, params.productId, body);
  });

  app.get("/v1/content/assets", async () => {
    return {
      items: await listMediaAssets(pool),
    };
  });

  app.post("/v1/content/assets", async (request, reply) => {
    const body = contentAssetSchema.parse(request.body);
    const asset = await createContentAsset(pool, body);
    return reply.code(201).send(asset);
  });

  app.patch("/v1/content/assets/:assetId", async (request) => {
    const params = z.object({
      assetId: z.coerce.number().int().positive(),
    }).parse(request.params);
    const body = z.object({
      status: z.enum(contentAssetStatusValues).optional(),
      title: z.string().trim().optional().nullable(),
      metadata: z.record(z.string(), jsonValueSchema).optional(),
    }).parse(request.body);

    return updateContentAsset(pool, params.assetId, body);
  });

  app.get("/v1/content/jobs", async () => {
    return {
      items: await listContentJobs(pool),
    };
  });

  app.post("/v1/content/jobs", async (request, reply) => {
    const body = contentJobSchema.parse(request.body);
    const job = await createContentJob(pool, body);
    return reply.code(201).send(job);
  });

  app.post("/v1/content/jobs/plan", async (request) => {
    const body = z.object({
      product_id: z.coerce.number().int().positive().optional().nullable(),
      limit: z.coerce.number().int().positive().max(200).optional(),
      requested_by: z.string().trim().optional().nullable(),
    }).parse(request.body ?? {});

    const jobs = await createPlannedJobsFromSuggestions(pool, {
      productId: body.product_id ?? null,
      limit: body.limit,
      requestedBy: body.requested_by ?? null,
    });

    return {
      ok: true,
      items: jobs,
    };
  });

  app.post("/v1/content/jobs/:jobId/run", async (request) => {
    const params = z.object({
      jobId: z.coerce.number().int().positive(),
    }).parse(request.params);

    return runContentJob(pool, params.jobId);
  });

  app.post("/v1/content/jobs/:jobId/sync", async (request) => {
    const params = z.object({
      jobId: z.coerce.number().int().positive(),
    }).parse(request.params);

    return syncContentJob(pool, params.jobId);
  });

  app.patch("/v1/content/jobs/:jobId", async (request) => {
    const params = z.object({
      jobId: z.coerce.number().int().positive(),
    }).parse(request.params);
    const body = z.object({
      status: z.enum(contentJobStatusValues).optional(),
      external_job_id: z.string().trim().optional().nullable(),
      external_status: z.string().trim().optional().nullable(),
      error_message: z.string().trim().optional().nullable(),
      started_at: z.string().trim().optional().nullable(),
      completed_at: z.string().trim().optional().nullable(),
      input_json: z.record(z.string(), jsonValueSchema).optional(),
    }).parse(request.body);

    return updateContentJobStatus(pool, params.jobId, body);
  });

  app.get("/v1/content/outputs", async () => {
    return {
      items: await listContentOutputs(pool),
    };
  });

  app.patch("/v1/content/outputs/:outputId/review", async (request) => {
    const params = z.object({
      outputId: z.coerce.number().int().positive(),
    }).parse(request.params);
    const body = z.object({
      review_status: z.enum(contentReviewStatusValues).optional(),
      review_notes: z.string().trim().optional().nullable(),
      metadata: z.record(z.string(), jsonValueSchema).optional(),
    }).parse(request.body);

    return updateContentOutputReview(pool, params.outputId, body);
  });

  app.get("/v1/content/publications", async () => {
    return {
      items: await listContentPublications(pool),
    };
  });

  app.post("/v1/content/publications", async (request, reply) => {
    const body = publicationSchema.parse(request.body);
    const publication = await createContentPublication(pool, body);
    return reply.code(201).send(publication);
  });

  app.patch("/v1/content/publications/:publicationId", async (request) => {
    const params = z.object({
      publicationId: z.coerce.number().int().positive(),
    }).parse(request.params);
    const body = z.object({
      status: z.enum(contentPublicationStatusValues).optional(),
      target_account: z.string().trim().optional().nullable(),
      platform_post_id: z.string().trim().optional().nullable(),
      published_url: z.string().trim().optional().nullable(),
      boost_candidate: z.boolean().optional(),
      boosted: z.boolean().optional(),
      published_at: z.string().trim().optional().nullable(),
      metadata: z.record(z.string(), jsonValueSchema).optional(),
    }).parse(request.body);

    return updateContentPublication(pool, params.publicationId, body);
  });

  app.get("/v1/content/planner/suggestions", async () => {
    return {
      items: await listContentPlannerSuggestions(pool),
    };
  });
};
