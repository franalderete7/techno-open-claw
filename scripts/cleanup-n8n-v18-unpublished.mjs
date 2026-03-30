#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = resolve(ROOT_DIR, ".env");
const CONTAINER_TMP_DIR =
  process.env.N8N_CONTAINER_TMP_DIR || "/tmp/techno-open-claw-n8n-v18-cleanup";
const N8N_API_BASE =
  process.env.N8N_API_BASE_URL ||
  process.env.N8N_API_BASE ||
  "http://127.0.0.1:5678";
const DRY_RUN = process.argv.includes("--dry-run");

const EXPECTED_NAMES = new Set([
  "TechnoStore - v18 Context Builder",
  "TechnoStore - v18 Router",
  "TechnoStore - v18 Info Responder",
  "TechnoStore - v18 Sales Responder",
  "TechnoStore - v18 Validator",
  "TechnoStore - v18 State Update",
  "TechnoStore - AI Sales Agent v18",
]);

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
    records.push({
      id: workflow.id == null ? null : String(workflow.id),
      name: String(workflow.name || ""),
      active: workflow.active === true,
    });
  }

  return records;
}

function buildAuth() {
  const auth = {
    apiBase: N8N_API_BASE.replace(/\/$/, ""),
    headers: {},
  };

  if (process.env.N8N_API_KEY) {
    auth.headers["X-N8N-API-KEY"] = process.env.N8N_API_KEY;
    return auth;
  }

  throw new Error(
    "Missing N8N_API_KEY. Put it in /srv/techno-open-claw/.env or export it before running cleanup.",
  );
}

async function deleteWorkflow(auth, workflowId) {
  const response = await fetch(`${auth.apiBase}/rest/workflows/${workflowId}`, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      ...auth.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DELETE ${workflowId} failed: ${response.status} ${text}`.trim());
  }
}

async function main() {
  const auth = buildAuth();
  const container = findN8nContainer();
  const tmpDir = mkdtempSync(join(tmpdir(), "techno-open-claw-n8n-cleanup-"));

  try {
    exportAllWorkflows(container, tmpDir);
    const records = loadWorkflowRecords(tmpDir).filter((record) => EXPECTED_NAMES.has(record.name));
    const toDelete = records.filter((record) => !record.active);

    if (toDelete.length === 0) {
      console.log("No unpublished TechnoStore v18 workflows found.");
      return;
    }

    for (const record of toDelete) {
      if (DRY_RUN) {
        console.log(`Would delete unpublished workflow: ${record.name} (${record.id})`);
        continue;
      }

      console.log(`Deleting unpublished workflow: ${record.name} (${record.id})`);
      await deleteWorkflow(auth, record.id);
    }

    if (DRY_RUN) {
      console.log("Dry run complete. No workflow changes were applied.");
      return;
    }

    console.log(`Deleted ${toDelete.length} unpublished TechnoStore v18 workflows.`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
