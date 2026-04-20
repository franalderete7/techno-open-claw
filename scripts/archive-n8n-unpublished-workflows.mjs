#!/usr/bin/env node
/**
 * Archive all *unpublished* (inactive) n8n workflows that are not already archived.
 *
 * Feasibility (see n8n public API):
 * - n8n 2.15+ exposes POST /api/v1/workflows/{id}/archive (and /unarchive).
 *   Ref: https://github.com/n8n-io/n8n/issues/27513
 * - There is no `n8n archive:workflow` CLI; this script uses HTTP.
 * - Public API PUT /workflows/{id} lists isArchived as read-only — use POST .../archive when available.
 * - If POST /archive returns 405, your n8n is older than the archive routes: upgrade n8n, or use
 *   the Docker CLI fallback (export → set isArchived → import:workflow), which runs inside the container.
 * - REST /rest/workflows PATCH often returns 401 with API keys (session/JWT only on some setups).
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
 *   N8N_ARCHIVE_UNPUBLISHED_SKIP_NAME_SUBSTRINGS — extra comma-separated substrings; name is skipped if it includes any
 *   N8N_ARCHIVE_UNPUBLISHED_NO_DEFAULT_SKIPS — if "1", do not apply built-in skips (see below)
 *   N8N_ARCHIVE_UNPUBLISHED_ONLY_NAME_PREFIX — if set, only consider workflows whose name starts with this prefix (e.g. "TechnoStore - v18")
 *   N8N_ARCHIVE_SKIP_CLI — if "1", do not use docker exec + n8n import fallback (default: CLI tried after HTTP fails)
 *
 * Built-in skips (unless N8N_ARCHIVE_UNPUBLISHED_NO_DEFAULT_SKIPS=1): any name containing "AI Sales Agent v20"
 * so inactive production v20 workflows are not archived with experiments.
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

function parseSkipSubstrings() {
  const raw = String(process.env.N8N_ARCHIVE_UNPUBLISHED_SKIP_NAME_SUBSTRINGS || "").trim();
  const fromEnv = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const noDefault = String(process.env.N8N_ARCHIVE_UNPUBLISHED_NO_DEFAULT_SKIPS || "").trim() === "1";
  const defaults = noDefault ? [] : ["AI Sales Agent v20"];
  return [...defaults, ...fromEnv];
}

function parseOnlyPrefix() {
  const p = String(process.env.N8N_ARCHIVE_UNPUBLISHED_ONLY_NAME_PREFIX || "").trim();
  return p || null;
}

function shouldSkipName(name, skipNames, skipSubstrings) {
  if (skipNames.has(name)) return { skip: true, reason: "exact name in N8N_ARCHIVE_UNPUBLISHED_SKIP_NAMES" };
  const lower = name.toLowerCase();
  for (const sub of skipSubstrings) {
    if (!sub) continue;
    if (lower.includes(sub.toLowerCase())) {
      return { skip: true, reason: `name contains protected substring "${sub}"` };
    }
  }
  return { skip: false, reason: "" };
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

function instanceRootUrl() {
  return N8N_API_BASE.replace(/\/$/, "").replace(/\/api\/v1$/, "");
}

function archivePostUrls(workflowId) {
  const root = instanceRootUrl();
  return [`${root}/api/v1/workflows/${workflowId}/archive`];
}

async function tryPostArchive(auth, workflowId) {
  const errors = [];
  let lastStatus = null;

  for (const url of archivePostUrls(workflowId)) {
    const res = await fetchHttp(auth, "POST", url, {});
    if (res.ok) {
      return { method: "POST", url };
    }

    lastStatus = res.status;
    errors.push(`${url} -> ${res.status} ${res.text.slice(0, 240)}`);
  }

  const err = new Error(`POST archive failed (last ${lastStatus}): ${errors.join(" | ")}`);
  err.status = lastStatus;
  throw err;
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

function restAuthVariants() {
  const key = process.env.N8N_API_KEY;
  const basic = buildAuth();
  const out = [];

  if (key) {
    out.push({
      headers: { ...basic.headers },
      basic: basic.basic,
    });
    out.push({
      headers: { Authorization: `Bearer ${key}` },
      basic: basic.basic,
    });
    out.push({
      headers: { ...basic.headers, Authorization: `Bearer ${key}` },
      basic: basic.basic,
    });
  } else {
    out.push(basic);
  }

  return out;
}

/**
 * Internal editor API (same family as DELETE /rest/workflows/:id in cleanup script).
 * Often 401 if the instance only accepts session cookies for /rest/.
 */
async function tryRestPatchArchive(workflowId) {
  const url = `${instanceRootUrl()}/rest/workflows/${workflowId}`;
  let lastError = null;

  for (const auth of restAuthVariants()) {
    for (const body of [{ isArchived: true }, { archived: true }]) {
      try {
        await fetchJson(auth, "PATCH", url, body);
        return { method: "REST PATCH", url };
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw lastError || new Error(`REST PATCH failed for ${workflowId}`);
}

/**
 * Works without HTTP archive/PATCH: export JSON, set isArchived, re-import (upserts by id).
 * Safe for inactive workflows (import deactivates; these are already inactive).
 */
function archiveViaContainerCli(container, workflowId) {
  const safeId = String(workflowId).replace(/[^a-zA-Z0-9_-]/g, "");
  if (safeId !== String(workflowId)) {
    throw new Error(`Refusing CLI archive: unexpected workflow id shape (${workflowId})`);
  }

  const containerPath = `${CONTAINER_TMP_DIR}/cli-archive-${safeId}.json`;

  containerSh(
    container,
    `mkdir -p '${CONTAINER_TMP_DIR}' && rm -f '${containerPath}' && n8n export:workflow --id='${safeId}' --output='${containerPath}'`,
  );

  containerSh(
    container,
    `node -e "` +
      `const fs=require('fs');` +
      `const p='${containerPath}';` +
      `const raw=fs.readFileSync(p,'utf8');` +
      `const original=JSON.parse(raw);` +
      `const wasArray=Array.isArray(original);` +
      `const arr=wasArray?original:[original];` +
      `for(const w of arr){w.isArchived=true;}` +
      `fs.writeFileSync(p,JSON.stringify(wasArray?arr:arr[0]));` +
      `"`,
  );

  containerSh(container, `n8n import:workflow --input='${containerPath}'`);
  containerSh(container, `rm -f '${containerPath}'`);

  return { method: "CLI import (docker exec)", url: containerPath };
}

async function archiveOne(auth, workflowId, container) {
  let postErrMsg = null;
  try {
    return await tryPostArchive(auth, workflowId);
  } catch (postErr) {
    postErrMsg = postErr.message || String(postErr);
  }

  try {
    return await tryRestPatchArchive(workflowId);
  } catch (restErr) {
    const skipCli = String(process.env.N8N_ARCHIVE_SKIP_CLI || "").trim() === "1";
    if (!skipCli && container) {
      try {
        return archiveViaContainerCli(container, workflowId);
      } catch (cliErr) {
        const hint =
          "HTTP: POST /api/v1/workflows/{id}/archive returned 405 on your n8n — upgrade n8n (archive API) or rely on CLI fallback. " +
          "REST PATCH often needs UI session auth, not only API keys. " +
          "CLI: ensure the script runs on the Docker host with access to the n8n container.";
        throw new Error(
          `${postErrMsg}\nREST fallback: ${restErr.message || restErr}\nCLI fallback: ${cliErr.message || cliErr}\n${hint}`,
        );
      }
    }

    const hint =
      "Tips: (1) Upgrade n8n so POST /api/v1/workflows/{id}/archive exists (not 405). " +
      "(2) Or run without N8N_ARCHIVE_SKIP_CLI=1 so the script can use docker exec + n8n import inside the container. " +
      "(3) API keys with workflow:delete scope for archive; /rest/ may need owner session instead of API key.";
    throw new Error(`${postErrMsg}\nREST fallback: ${restErr.message || restErr}\n${hint}`);
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
  const skipSubstrings = parseSkipSubstrings();
  const onlyPrefix = parseOnlyPrefix();
  const container = findN8nContainer();
  const tmpDir = mkdtempSync(join(tmpdir(), "techno-open-claw-n8n-archive-"));

  try {
    exportAllWorkflows(container, tmpDir);
    const records = loadWorkflowRecords(tmpDir);
    const verbose = String(process.env.N8N_ARCHIVE_UNPUBLISHED_VERBOSE || "").trim() === "1";
    const skippedDetails = [];

    const candidates = records.filter((r) => {
      if (r.active || r.archived) return false;
      if (onlyPrefix && !r.name.startsWith(onlyPrefix)) {
        if (verbose) skippedDetails.push({ ...r, why: `name does not start with prefix "${onlyPrefix}"` });
        return false;
      }
      const { skip, reason } = shouldSkipName(r.name, skipNames, skipSubstrings);
      if (skip) {
        if (verbose) skippedDetails.push({ ...r, why: reason });
        return false;
      }
      return true;
    });

    const protectedSkipCount = records.filter((r) => {
      if (r.active || r.archived) return false;
      if (onlyPrefix && !r.name.startsWith(onlyPrefix)) return false;
      return shouldSkipName(r.name, skipNames, skipSubstrings).skip;
    }).length;

    if (verbose && skippedDetails.length > 0) {
      console.log(`Skipped ${skippedDetails.length} unpublished workflow(s) (prefix / protected names):`);
      for (const s of skippedDetails) {
        console.log(` - ${s.name} (${s.id}) — ${s.why}`);
      }
      console.log("");
    }

    if (candidates.length === 0) {
      console.log("No unpublished, non-archived workflows found (after skip / prefix rules).");
      if (protectedSkipCount > 0) {
        console.log(
          `${protectedSkipCount} unpublished workflow(s) skipped by name rules (e.g. protected v20). ` +
            "Set N8N_ARCHIVE_UNPUBLISHED_VERBOSE=1 to list them.",
        );
      }
      if (!onlyPrefix) {
        console.log(
          'Tip: use N8N_ARCHIVE_UNPUBLISHED_ONLY_NAME_PREFIX to limit by workflow name prefix.',
        );
      }
      return;
    }

    console.log(`Found ${candidates.length} unpublished workflow(s) to archive:`);
    for (const r of candidates) {
      console.log(` - ${r.name} (${r.id})`);
    }
    if (onlyPrefix) {
      console.log(`(filtered by name prefix: "${onlyPrefix}")`);
    }
    if (protectedSkipCount > 0) {
      console.log(
        `(Also skipped ${protectedSkipCount} unpublished workflow(s) matching protected-name rules.)`,
      );
    }

    if (!APPLY) {
      console.log("\nDry run only. Re-run with --apply to archive these workflows.");
      return;
    }

    for (const r of candidates) {
      process.stdout.write(`Archiving ${r.name} (${r.id})... `);
      try {
        const result = await archiveOne(auth, r.id, container);
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
