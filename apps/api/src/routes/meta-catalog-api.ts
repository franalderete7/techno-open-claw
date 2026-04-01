import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireBearerToken } from "../auth.js";
import {
  buildMetaCatalogFeedTsv,
  buildMetaCatalogSnapshot,
  isValidMetaCatalogFeedToken,
} from "../meta-catalog.js";

const metaCatalogFeedQuerySchema = z.object({
  token: z.string().trim().min(1),
});

const metaCatalogPreviewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const metaCatalogApiRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/meta/catalog/feed.tsv", async (request, reply) => {
    const query = metaCatalogFeedQuerySchema.safeParse(request.query);

    if (!query.success || !isValidMetaCatalogFeedToken(query.data.token)) {
      return reply.code(401).send({ error: "Invalid feed token." });
    }

    const { tsv } = await buildMetaCatalogFeedTsv();
    return reply
      .header("content-type", "text/tab-separated-values; charset=utf-8")
      .header("cache-control", "public, max-age=300")
      .send(tsv);
  });

  app.get("/v1/meta/catalog/preview", { preHandler: requireBearerToken }, async (request) => {
    const query = metaCatalogPreviewQuerySchema.parse(request.query);
    const snapshot = await buildMetaCatalogSnapshot();

    return {
      ...snapshot,
      items: snapshot.items.slice(0, query.limit),
      preview_limit: query.limit,
    };
  });

  app.get("/v1/meta/catalog/health", { preHandler: requireBearerToken }, async () => {
    return buildMetaCatalogSnapshot();
  });
};
