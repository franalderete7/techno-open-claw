import { FastifyPluginAsync } from "fastify";
import { query } from "../db.js";

export const auditRoutes: FastifyPluginAsync = async (app) => {
  // GET /v1/audit - List audit logs
  app.get("/", async (request, reply) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const limit = url.searchParams.get("limit") || "100";
      const actor_type = url.searchParams.get("actor_type");
      const entity_type = url.searchParams.get("entity_type");
      
      let whereClause = "1=1";
      const params: any[] = [];
      let paramIndex = 1;
      
      if (actor_type) {
        whereClause += ` AND actor_type = $${paramIndex}`;
        params.push(actor_type);
        paramIndex++;
      }
      
      if (entity_type) {
        whereClause += ` AND entity_type = $${paramIndex}`;
        params.push(entity_type);
        paramIndex++;
      }
      
      const items = await query(
        `SELECT id, actor_type, action, entity_type, entity_id, metadata, created_at
         FROM audit_logs
         WHERE ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIndex}`,
        [...params, parseInt(limit)]
      );
      
      return reply.send({
        ok: true,
        items,
        count: items.length,
      });
    } catch (error) {
      console.error("Failed to fetch audit logs:", error);
      return reply.code(500).send({ error: "Failed to fetch audit logs" });
    }
  });

  // POST /v1/audit - Create audit log entry
  app.post("/", async (request, reply) => {
    try {
      const body = request.body as any;
      
      const rows = await query(
        `INSERT INTO audit_logs (
           actor_type, action, entity_type, entity_id, metadata, created_at
         ) VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id, actor_type, action, entity_type, entity_id, metadata, created_at`,
        [
          body.actor_type,
          body.action,
          body.entity_type,
          body.entity_id,
          body.metadata,
        ]
      );
      
      return reply.send({
        ok: true,
        item: rows[0],
      });
    } catch (error) {
      console.error("Failed to create audit log:", error);
      return reply.code(500).send({ error: "Failed to create audit log" });
    }
  });
};
