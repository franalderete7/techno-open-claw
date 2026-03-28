import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getMetaAdsOverview } from "../meta-ads.js";

const metaAdsOverviewQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  limit: z.coerce.number().int().min(1).max(200).default(80),
});

export const metaAdsApiRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/meta/ads/overview", async (request) => {
    const query = metaAdsOverviewQuerySchema.parse(request.query);
    return getMetaAdsOverview(query);
  });
};
