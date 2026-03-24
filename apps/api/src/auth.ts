import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

export async function requireBearerToken(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing bearer token" });
  }

  const token = header.slice("Bearer ".length).trim();

  if (token !== config.API_BEARER_TOKEN) {
    return reply.code(401).send({ error: "Invalid bearer token" });
  }
}
