import { FastifyPluginAsync } from "fastify";
import { query } from "../db.js";

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  // GET /v1/settings - List all settings
  app.get("/", async (request, reply) => {
    try {
      const items = await query(
        "SELECT key, value, updated_at FROM settings ORDER BY key"
      );
      
      return reply.send({
        ok: true,
        items,
        count: items.length,
      });
    } catch (error) {
      console.error("Failed to fetch settings:", error);
      return reply.code(500).send({ error: "Failed to fetch settings" });
    }
  });

  // GET /v1/settings/:key - Get single setting
  app.get("/:key", async (request, reply) => {
    try {
      const key = (request.params as any).key as string;
      const rows = await query(
        "SELECT key, value, updated_at FROM settings WHERE key = $1",
        [key]
      );
      
      if (rows.length === 0) {
        return reply.code(404).send({ error: "Setting not found" });
      }
      
      return reply.send({
        ok: true,
        item: rows[0],
      });
    } catch (error) {
      console.error("Failed to fetch setting:", error);
      return reply.code(500).send({ error: "Failed to fetch setting" });
    }
  });

  // PUT /v1/settings/:key - Update or create setting
  app.put("/:key", async (request, reply) => {
    try {
      const key = (request.params as any).key as string;
      const body = request.body as any;
      const value = body.value;
      
      const rows = await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) 
         DO UPDATE SET value = $2, updated_at = NOW()
         RETURNING key, value, updated_at`,
        [key, value]
      );
      
      return reply.send({
        ok: true,
        item: rows[0],
      });
    } catch (error) {
      console.error("Failed to update setting:", error);
      return reply.code(500).send({ error: "Failed to update setting" });
    }
  });
};
