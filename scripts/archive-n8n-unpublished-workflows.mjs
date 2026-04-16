#!/usr/bin/env node
/**
 * Archive all *unpublished* (inactive) n8n workflows that are not already archived.
 *
 * Feasibility (see n8n public API):
 * - n8n 2.15+ exposes POST /api/v1/workflows/{id}/archive (and /unarchive).
 *   Ref: https://github.com/n8n-io/n8n/issues/27513
 * - There is no `n8n archive:workflow` CLI; this script uses HTTP.
 *
 * Discovery: exports all workflows from the n8n container (same pattern as
 * scripts/cleanup-n8n-v18-unpublished.mjs), then filters client-side.
 *
 * Usage:
 *   node ./scripts/archive-n8n-unpublished-workflows.mjs              # dry-run (list only)
 *   node ./scripts/archive-n8n-unpublished-workflows.mjs --apply       # archive matching workflows
 *
 * Env:
 *   N8N_API_BASE_URL | N8N_API_BASE  — default http://127.0.0.1:5678 (no /api/v1 suffix)
 *   N8N_API_KEY — preferred (X-N8N-API-KEY). Required for public /api/v1 routes.
 *   N8N_API_USER / N8N_API_PASS — optional Basic auth (some setups)
 *   N8N_CONTAINER_NAME — optional docker container name
 *   N8N_CONTAINER_TMP_DIR — default /tmp/techno-open-claw-n8n-archive-unpublished
 *   N8N_ARCHIVE_UNPUBLISHED_SKIP_NAMES — comma-separated exact workflow names to skip
 *
 * @see https://docs.n8n.io/api/
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = resolve(ROOT_DIR, ".env");
const CONTAINER_TMP_DIR =
  process.env.N8N_CONTAINER_TMP_DIR || "/tmp/techno-open-claw-n8n-archive-unpublished";

const APPLY = process.argv.includes("--apply");

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] != null) continue;

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadDotEnv(ENV_FILE);

const N8N_API_BASE = (
  process.env.N8N_API_BASE_URL ||
  process.env.N8N_API_BASE ||
  "http://127.0.0.1:5678"
).replace(/\/$/, "");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT_DIR,
    encoding: "utf8",
    stdio: options.stdio || "pipe",
    env: { ...process.env, ...(options.env || {}) },
  });

  if (result.status !== 0) {
    const detail = result.stderr || result.stdout || "";
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${detail}`.trim());
  }

  return (result.stdout || "").trim();
}

function docker(...args) {
  return run("docker", args);
}

function findN8nContainer() {
  if (process.env.N8N_CONTAINER_NAME) {
    return process.env.N8N_CONTAINER_NAME;
  }

  const detected = docker("ps", "--format", "{{.Names}}")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /(^|[-_])n8n([_-]|$)/.test(line));

  if (!detected) {
    throw new Error("Could not detect an n8n container. Set N8N_CONTAINER_NAME and rerun.");
  }

  return detected;
}

function containerSh(container, script) {
  return docker("exec", container, "sh", "-lc", script);
}

function exportAllWorkflows(container, hostDir) {
  const containerDir = `${CONTAINER_TMP_DIR}/export`;
  containerSh(
    container,
    `rm -rf '${containerDir}' && mkdir -p '${containerDir}' && n8n export:workflow --all --separate --output='${containerDir}' >/dev/null`,
  );
  docker("cp", `${container}:${containerDir}/.`, hostDir);
}

function loadWorkflowRecords(dir) {
  const records = [];

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const fullPath = join(dir, file);
    const workflow = JSON.parse(readFileSync(fullPath, "utf8"));
    const id = workflow.id == null ? null : String(workflow.id);
    if (!id) continue;

    records.push({
      id,
      name: String(workflow.name || ""),
      active: workflow.active === true,
      archived: workflow.isArchived === true || workflow.archived === true,
    });
  }

  return records;
}

function parseSkipNames() {
  const raw = String(process.env.N8N_ARCHIVE_UNPUBLISHED_SKIP_NAMES || "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function buildAuth() {
  const headers = {};

  if (process.env.N8N_API_KEY) {
    headers["X-N8N-API-KEY"] = process.env.N8N_API_KEY;
  }

  const basicUser = process.env.N8N_API_USER;
  const basicPass = process.env.N8N_API_PASS;

  return {
    headers,
    basic:
      basicUser && basicPass != null
        ? { user: basicUser, pass: String(basicPass) }
        : null,
  };
}

async function fetchHttp(auth, method, url, body) {
  const headers = {
    Accept: "application/json",
    ...auth.headers,
  };

  if (auth.basic?.user) {
    const token = Buffer.from(`${auth.basic.user}:${auth.basic.pass}`).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }

  if (body != null) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

function workflowApiUrls(workflowId) {
  const normalizedBase = N8N_API_BASE.replace(/\/$/, "");
  const rootBase = normalizedBase.replace(/\/api\/v1$/, "");
  const urls = normalizedBase.includes("/api/v1")
    ? [`${normalizedBase}/workflows/${workflowId}`, `${rootBase}/rest/workflows/${workflowId}`]
    : [`${normalizedBase}/rest/workflows/${workflowId}`, `${normalizedBase}/api/v1/workflows/${workflowId}`];

  return [...new Set(urls)];
}

function archivePostUrls(workflowId) {
  const normalizedBase = N8N_API_BASE.replace(/\/$/, "");
  const rootBase = normalizedBase.replace(/\/api\/v1$/, "");
  const bases = normalizedBase.includes("/api/v1") ? [rootBase, normalizedBase.replace(/\/api\/v1$/, "")] : [normalizedBase];

  const out = [];
  for (const b of [...new Set(bases.map((x) => x.replace(/\/$/, "")))]) {
    out.push(`${b}/api/v1/workflows/${workflowId}/archive`);
  }
  return [...new Set(out)];
}

async function tryPostArchive(auth, workflowId) {
  const errors = [];
  let lastStatus = null;

  for (const url of archivePostUrls(workflowId)) {
    const res = await fetchHttp(auth, "POST", url, null);
    if (res.ok) {
      return { method: "POST", url };
    }

    lastStatus = res.status;
    errors.push(`${res.status} ${res.text.slice(0, 200)}`);

    if (res.status === 401 || res.status === 403) {
      const err = new Error(`POST ${url} -> ${res.status} ${res.text}`.trim());
      err.status = res.status;
      throw err;
    }
  }

  const err = new Error(`POST archive failed (last ${lastStatus}): ${errors.join(" | ")}`);
  err.status = lastStatus;
  throw err;
}

function workflowPatchAttempts(patch) {
  const attempts = [patch];
  if ("isArchived" in patch && !("archived" in patch)) {
    attempts.push({ ...patch, archived: patch.isArchived });
  }
  return attempts;
}

function buildWorkflowUpdatePayload(workflow, patch) {
  const payload = {
    name: workflow.name,
    nodes: workflow.nodes || [],
    connections: workflow.connections || {},
    settings: workflow.settings || {},
  };

  for (const key of [
    "active",
    "description",
    "staticData",
    "pinData",
    "meta",
    "versionId",
    "isArchived",
    "archived",
  ]) {
    if (workflow[key] !== undefined) {
      payload[key] = workflow[key];
    }
  }

  Object.assign(payload, patch);
  return payload;
}

async function fetchJson(auth, method, url, body) {
  const res = await fetchHttp(auth, method, url, body);
  if (!res.ok) {
    const err = new Error(`${method} ${url} failed: ${res.status} ${res.text}`.trim());
    err.status = res.status;
    throw err;
  }
  return res.text ? JSON.parse(res.text) : null;
}

async function getWorkflowForUpdate(auth, workflowId) {
  let lastError = null;

  for (const url of workflowApiUrls(workflowId)) {
    try {
      const workflow = await fetchJson(auth, "GET", url);
      return { url, workflow };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Could not load workflow ${workflowId}`);
}

async function putWorkflow(auth, url, workflow, patch) {
  const payload = buildWorkflowUpdatePayload(workflow, patch);
  return fetchJson(auth, "PUT", url, payload);
}

async function patchArchiveFallback(auth, workflowId) {
  const attempts = workflowPatchAttempts({ isArchived: true });
  let lastError = null;

  for (const path of workflowApiUrls(workflowId)) {
    for (const body of attempts) {
      try {
        await fetchJson(auth, "PATCH", path, body);
        return { method: "PATCH", url: path };
      } catch (error) {
        lastError = error;
      }
    }
  }

  const methodBlocked = String(lastError?.message || "").includes("405");

  if (!methodBlocked) {
    throw lastError || new Error(`Could not patch workflow ${workflowId}`);
  }

  const { url, workflow } = await getWorkflowForUpdate(auth, workflowId);

  for (const body of attempts) {
    try {
      await putWorkflow(auth, url, workflow, body);
      return { method: "PUT", url };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Could not archive workflow ${workflowId}`);
}

async function archiveOne(auth, workflowId) {
  try {
    return await tryPostArchive(auth, workflowId);
  } catch (postErr) {
    if (postErr?.status === 401 || postErr?.status === 403) {
      throw postErr;
    }
    return await patchArchiveFallback(auth, workflowId);
  }
}

async function main() {
  if (!process.env.N8N_API_KEY && !process.env.N8N_API_USER) {
    console.error(
      "Missing auth: set N8N_API_KEY (recommended) or N8N_API_USER + N8N_API_PASS in .env or the environment.",
    );
    process.exit(1);
  }

  const auth = buildAuth();
  const skipNames = parseSkipNames();
  const container = findN8nContainer();
  const tmpDir = mkdtempSync(join(tmpdir(), "techno-open-claw-n8n-archive-"));

  try {
    exportAllWorkflows(container, tmpDir);
    const records = loadWorkflowRecords(tmpDir);
    const candidates = records.filter(
      (r) => !r.active && !r.archived && !skipNames.has(r.name),
    );

    if (candidates.length === 0) {
      console.log("No unpublished, non-archived workflows found (after skip list).");
      return;
    }

    console.log(`Found ${candidates.length} unpublished workflow(s) to archive:`);
    for (const r of candidates) {
      console.log(` - ${r.name} (${r.id})`);
    }

    if (!APPLY) {
      console.log("\nDry run only. Re-run with --apply to archive these workflows.");
      return;
    }

    for (const r of candidates) {
      process.stdout.write(`Archiving ${r.name} (${r.id})... `);
      try {
        const result = await archiveOne(auth, r.id);
        console.log(`ok (${result.method})`);
      } catch (error) {
        console.log(`FAILED: ${error.message || error}`);
      }
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
