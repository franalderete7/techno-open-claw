#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = resolve(ROOT_DIR, ".env");

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

const WORKFLOW_DIR = resolve(process.env.N8N_WORKFLOW_DIR || join(ROOT_DIR, "n8n/v18"));
const BACKUP_ROOT = resolve(
  process.env.N8N_BACKUP_DIR || join(ROOT_DIR, "n8n/backups/v18"),
);
const CONTAINER_TMP_DIR =
  process.env.N8N_CONTAINER_TMP_DIR || "/tmp/techno-open-claw-n8n-v18-deploy";
const N8N_API_BASE =
  process.env.N8N_API_BASE_URL ||
  process.env.N8N_API_BASE ||
  "http://127.0.0.1:5678";
const N8N_SKIP_RESTART = String(process.env.N8N_SKIP_RESTART || "").toLowerCase() === "true";
const DRY_RUN = process.argv.includes("--dry-run");

const CHILD_WORKFLOWS = [
  {
    file: "TechnoStore_v18_context_builder.json",
    name: "TechnoStore - v18 Context Builder",
  },
  {
    file: "TechnoStore_v18_router.json",
    name: "TechnoStore - v18 Router",
  },
  {
    file: "TechnoStore_v18_info_responder.json",
    name: "TechnoStore - v18 Info Responder",
  },
  {
    file: "TechnoStore_v18_sales_responder.json",
    name: "TechnoStore - v18 Sales Responder",
  },
  {
    file: "TechnoStore_v18_validator.json",
    name: "TechnoStore - v18 Validator",
  },
  {
    file: "TechnoStore_v18_state_update.json",
    name: "TechnoStore - v18 State Update",
  },
];

const ENTRY_WORKFLOW = {
  file: "TechnoStore_v18_entry.json",
  name: "TechnoStore - AI Sales Agent v18",
};

const EXPECTED_WORKFLOWS = [...CHILD_WORKFLOWS, ENTRY_WORKFLOW];

function log(message) {
  console.log(message);
}

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

function dockerAllowFailure(...args) {
  return spawnSync("docker", args, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: "pipe",
    env: process.env,
  });
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

function containerCommandAllowFailure(container, ...args) {
  return dockerAllowFailure("exec", container, ...args);
}

function ensureWorkflowFiles() {
  for (const workflow of EXPECTED_WORKFLOWS) {
    const path = join(WORKFLOW_DIR, workflow.file);
    if (!existsSync(path)) {
      throw new Error(`Workflow file not found: ${path}`);
    }
  }
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function exportAllWorkflows(container, hostDir) {
  const containerDir = `${CONTAINER_TMP_DIR}/export`;
  containerSh(
    container,
    `rm -rf '${containerDir}' && mkdir -p '${containerDir}' && n8n export:workflow --all --separate --output='${containerDir}' >/dev/null`,
  );
  mkdirSync(hostDir, { recursive: true });
  docker("cp", `${container}:${containerDir}/.`, hostDir);
}

function loadWorkflowRecords(dir) {
  const records = [];

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const fullPath = join(dir, file);
    const workflow = JSON.parse(readFileSync(fullPath, "utf8"));
    records.push({
      file,
      path: fullPath,
      id: workflow.id == null ? null : String(workflow.id),
      name: String(workflow.name || ""),
      active: workflow.active === true,
      archived: workflow.isArchived === true || workflow.archived === true,
      updatedAt: workflow.updatedAt || null,
      workflow,
    });
  }

  return records;
}

function pickCanonical(records) {
  return [...records].sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (a.active !== b.active) return a.active ? -1 : 1;
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return bTime - aTime;
  })[0];
}

function groupExpectedWorkflows(records) {
  const grouped = new Map();

  for (const expected of EXPECTED_WORKFLOWS) {
    const matches = records.filter((record) => record.name === expected.name);
    const canonical = matches.length > 0 ? pickCanonical(matches) : null;
    const duplicates = canonical
      ? matches.filter((record) => record.id !== canonical.id)
      : [];

    grouped.set(expected.name, {
      expected,
      canonical,
      duplicates,
      matches,
    });
  }

  return grouped;
}

function backupExistingWorkflows(grouped, backupDir) {
  mkdirSync(backupDir, { recursive: true });
  const manifest = [];

  for (const { expected, matches } of grouped.values()) {
    for (const record of matches) {
      const backupName = `${expected.file.replace(/\.json$/, "")}__${record.id || "no-id"}${
        record.active ? "__active" : ""
      }${record.archived ? "__archived" : ""}.json`;
      copyFileSync(record.path, join(backupDir, backupName));
      manifest.push({
        name: record.name,
        id: record.id,
        active: record.active,
        archived: record.archived,
        sourceFile: record.file,
        backupFile: backupName,
      });
    }
  }

  writeFileSync(join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function detectAuth(container) {
  const auth = {
    apiBase: N8N_API_BASE.replace(/\/$/, ""),
    type: "none",
    headers: {},
  };

  if (process.env.N8N_API_KEY) {
    auth.type = "apiKey";
    auth.headers["X-N8N-API-KEY"] = process.env.N8N_API_KEY;
    return auth;
  }

  if (process.env.N8N_API_USER && process.env.N8N_API_PASS) {
    auth.type = "basic";
    auth.basic = {
      user: process.env.N8N_API_USER,
      pass: process.env.N8N_API_PASS,
    };
    return auth;
  }

  const basicAuthEnv = containerSh(
    container,
    "printf '%s\\n%s\\n%s' \"$N8N_BASIC_AUTH_ACTIVE\" \"$N8N_BASIC_AUTH_USER\" \"$N8N_BASIC_AUTH_PASSWORD\"",
  ).split("\n");

  if ((basicAuthEnv[0] || "").trim().toLowerCase() === "true") {
    auth.type = "basic";
    auth.basic = {
      user: (basicAuthEnv[1] || "").trim(),
      pass: (basicAuthEnv[2] || "").trim(),
    };
  }

  return auth;
}

async function requestJson(auth, method, path, body) {
  const url = `${auth.apiBase}${path}`;
  const headers = {
    Accept: "application/json",
    ...auth.headers,
  };

  if (body != null) {
    headers["Content-Type"] = "application/json";
  }

  if (auth.type === "basic" && auth.basic?.user) {
    const token = Buffer.from(`${auth.basic.user}:${auth.basic.pass}`).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${url} failed: ${response.status} ${text}`.trim());
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function patchWorkflow(auth, workflowId, patch) {
  const attempts = [patch];

  if ("isArchived" in patch && !("archived" in patch)) {
    attempts.push({ ...patch, archived: patch.isArchived });
  }

  let lastError = null;

  for (const body of attempts) {
    try {
      return await requestJson(auth, "PATCH", `/rest/workflows/${workflowId}`, body);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Could not patch workflow ${workflowId}`);
}

function cliSupports(container, command) {
  const result = containerCommandAllowFailure(container, "sh", "-lc", `n8n ${command} --help >/dev/null 2>&1`);
  return result.status === 0;
}

function unpublishWorkflow(container, auth, workflowId) {
  if (DRY_RUN) return;

  if (cliSupports(container, "unpublish:workflow")) {
    containerSh(container, `n8n unpublish:workflow --id='${workflowId}' >/dev/null`);
    return;
  }

  if (cliSupports(container, "update:workflow")) {
    containerSh(container, `n8n update:workflow --id='${workflowId}' --active=false >/dev/null`);
    return;
  }

  throw new Error("No supported CLI command found to unpublish workflows.");
}

function publishWorkflow(container, auth, workflowId) {
  if (DRY_RUN) return;

  if (cliSupports(container, "publish:workflow")) {
    containerSh(container, `n8n publish:workflow --id='${workflowId}' >/dev/null`);
    return;
  }

  if (cliSupports(container, "update:workflow")) {
    containerSh(container, `n8n update:workflow --id='${workflowId}' --active=true >/dev/null`);
    return;
  }

  throw new Error("No supported CLI command found to publish workflows.");
}

async function archiveWorkflow(container, auth, workflowId) {
  if (DRY_RUN) return;

  if (cliSupports(container, "archive:workflow")) {
    containerSh(container, `n8n archive:workflow --id='${workflowId}' >/dev/null`);
    return;
  }

  await patchWorkflow(auth, workflowId, { isArchived: true });
}

async function unarchiveWorkflow(container, auth, workflowId) {
  if (DRY_RUN) return;

  if (cliSupports(container, "unarchive:workflow")) {
    containerSh(container, `n8n unarchive:workflow --id='${workflowId}' >/dev/null`);
    return;
  }

  await patchWorkflow(auth, workflowId, { isArchived: false });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildImportDir(tmpDir) {
  const importDir = join(tmpDir, "import");
  mkdirSync(importDir, { recursive: true });

  for (const workflow of CHILD_WORKFLOWS) {
    const sourcePath = join(WORKFLOW_DIR, workflow.file);
    const payload = JSON.parse(readFileSync(sourcePath, "utf8"));
    delete payload.id;
    payload.active = false;
    payload.isArchived = false;
    writeFileSync(join(importDir, workflow.file), `${JSON.stringify(payload, null, 2)}\n`);
  }

  return importDir;
}

function importWorkflowDir(container, hostDir) {
  const containerDir = `${CONTAINER_TMP_DIR}/import`;
  containerSh(container, `rm -rf '${containerDir}' && mkdir -p '${containerDir}'`);
  docker("cp", `${hostDir}/.`, `${container}:${containerDir}`);
  containerSh(container, `n8n import:workflow --separate --input='${containerDir}' >/dev/null`);
}

function patchEntryWorkflow(tmpDir, groupedAfterChildren) {
  const sourcePath = join(WORKFLOW_DIR, ENTRY_WORKFLOW.file);
  const payload = JSON.parse(readFileSync(sourcePath, "utf8"));
  delete payload.id;
  payload.active = false;
  payload.isArchived = false;

  const idByName = new Map();
  for (const workflow of CHILD_WORKFLOWS) {
    const record = groupedAfterChildren.get(workflow.name)?.canonical || null;
    if (!record?.id) {
      throw new Error(`Missing imported workflow id for ${workflow.name}`);
    }
    idByName.set(workflow.name, record.id);
  }

  for (const node of payload.nodes || []) {
    if (node.type !== "n8n-nodes-base.executeWorkflow") continue;

    const workflowId = node.parameters?.workflowId;
    const childName = workflowId?.cachedResultName;
    if (!childName || !idByName.has(childName)) continue;

    node.parameters.workflowId = {
      ...(workflowId || {}),
      __rl: true,
      mode: "list",
      value: idByName.get(childName),
      cachedResultName: childName,
    };
  }

  const targetPath = join(tmpDir, ENTRY_WORKFLOW.file);
  writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`);
  return targetPath;
}

function importSingleWorkflow(container, hostFile) {
  const containerPath = `${CONTAINER_TMP_DIR}/single/${basename(hostFile)}`;
  containerSh(container, `rm -rf '${CONTAINER_TMP_DIR}/single' && mkdir -p '${CONTAINER_TMP_DIR}/single'`);
  docker("cp", hostFile, `${container}:${containerPath}`);
  containerSh(container, `n8n import:workflow --input='${containerPath}' >/dev/null`);
}

function verifyEntryLinks(grouped) {
  const entry = grouped.get(ENTRY_WORKFLOW.name)?.canonical;
  if (!entry) {
    throw new Error("Entry workflow missing after import.");
  }

  const workflow = entry.workflow;
  const nodeMap = new Map((workflow.nodes || []).map((node) => [node.name, node]));

  for (const child of CHILD_WORKFLOWS) {
    const expectedNodeName = {
      "TechnoStore - v18 Context Builder": "Execute Context Builder",
      "TechnoStore - v18 Router": "Execute Router",
      "TechnoStore - v18 Info Responder": "Execute Info Responder",
      "TechnoStore - v18 Sales Responder": "Execute Sales Responder",
      "TechnoStore - v18 Validator": "Execute Validator",
      "TechnoStore - v18 State Update": "Execute State Update",
    }[child.name];

    const node = nodeMap.get(expectedNodeName);
    const linkedId = node?.parameters?.workflowId?.value;
    const childId = grouped.get(child.name)?.canonical?.id;

    if (!node || !linkedId || linkedId !== childId) {
      throw new Error(`Entry workflow link mismatch for ${child.name}`);
    }
  }
}

function restartContainer(container) {
  if (DRY_RUN) return;
  docker("restart", container);
}

async function main() {
  ensureWorkflowFiles();

  const n8nContainer = findN8nContainer();
  const tmpDir = mkdtempSync(join(tmpdir(), "techno-open-claw-n8n-v18-"));
  const exportDir = join(tmpDir, "export");
  const backupDir = join(BACKUP_ROOT, timestampSlug());
  const auth = detectAuth(n8nContainer);

  log(`Using n8n container: ${n8nContainer}`);
  log(`Workflow source dir: ${WORKFLOW_DIR}`);
  log(`Backup dir: ${backupDir}`);
  if (DRY_RUN) {
    log("Dry run mode enabled.");
  }

  try {
    exportAllWorkflows(n8nContainer, exportDir);
    const currentRecords = loadWorkflowRecords(exportDir);
    const currentGrouped = groupExpectedWorkflows(currentRecords);

    backupExistingWorkflows(currentGrouped, backupDir);
    log("Backed up current v18 workflow set.");

    if (DRY_RUN) {
      for (const { expected, matches } of currentGrouped.values()) {
        for (const record of matches) {
          if (!record.active) continue;
          log(`Would unpublish current workflow: ${expected.name} (${record.id})`);
        }

        for (const record of matches) {
          if (record.archived) {
            log(`Would keep archived workflow as archived: ${expected.name} (${record.id})`);
            continue;
          }
          log(`Would archive existing workflow: ${expected.name} (${record.id})`);
        }
      }

      log("Would import child workflows.");
      log("Would patch and import the entry workflow.");
      log("Would unarchive imported workflows if needed, then publish child workflows and the entry workflow.");
      log("");
      log("Dry run complete. No workflow changes were applied.");
      log(`Backups saved to: ${backupDir}`);
      return;
    }

    for (const { expected, matches } of currentGrouped.values()) {
      for (const record of matches) {
        if (!record.active) continue;
        log(`Unpublishing current workflow: ${expected.name} (${record.id})`);
        unpublishWorkflow(n8nContainer, auth, record.id);
      }
    }

    await sleep(1200);

    for (const { expected, matches } of currentGrouped.values()) {
      for (const record of matches) {
        if (record.archived) {
          log(`Keeping archived workflow archived: ${expected.name} (${record.id})`);
          continue;
        }

        log(`Archiving existing workflow: ${expected.name} (${record.id})`);
        await archiveWorkflow(n8nContainer, auth, record.id);
      }
    }

    await sleep(1200);

    const importDir = buildImportDir(tmpDir);
    log("Importing child workflows...");
    importWorkflowDir(n8nContainer, importDir);

    const afterChildrenDir = join(tmpDir, "after-children");
    exportAllWorkflows(n8nContainer, afterChildrenDir);
    const afterChildrenGrouped = groupExpectedWorkflows(loadWorkflowRecords(afterChildrenDir));

    const patchedEntryFile = patchEntryWorkflow(tmpDir, afterChildrenGrouped);
    log("Importing entry workflow...");
    importSingleWorkflow(n8nContainer, patchedEntryFile);

    const finalExportDir = join(tmpDir, "final");
    exportAllWorkflows(n8nContainer, finalExportDir);
    const finalGrouped = groupExpectedWorkflows(loadWorkflowRecords(finalExportDir));

    verifyEntryLinks(finalGrouped);
    log("Verified entry workflow links.");

    for (const workflow of CHILD_WORKFLOWS) {
      const record = finalGrouped.get(workflow.name)?.canonical;
      if (!record?.id) {
        throw new Error(`Missing workflow after import: ${workflow.name}`);
      }
      if (record.archived) {
        log(`Unarchiving child workflow before publish: ${workflow.name} (${record.id})`);
        await unarchiveWorkflow(n8nContainer, auth, record.id);
      }
      log(`Publishing child workflow: ${workflow.name} (${record.id})`);
      publishWorkflow(n8nContainer, auth, record.id);
    }

    const entryRecord = finalGrouped.get(ENTRY_WORKFLOW.name)?.canonical;
    if (!entryRecord?.id) {
      throw new Error("Missing entry workflow after import.");
    }
    if (entryRecord.archived) {
      log(`Unarchiving entry workflow before publish: ${ENTRY_WORKFLOW.name} (${entryRecord.id})`);
      await unarchiveWorkflow(n8nContainer, auth, entryRecord.id);
    }
    log(`Publishing entry workflow: ${ENTRY_WORKFLOW.name} (${entryRecord.id})`);
    publishWorkflow(n8nContainer, auth, entryRecord.id);

    if (!N8N_SKIP_RESTART) {
      log("Restarting n8n to refresh webhook registrations and active workflow state...");
      restartContainer(n8nContainer);
    }

    const summary = EXPECTED_WORKFLOWS.map((workflow) => {
      const record = finalGrouped.get(workflow.name)?.canonical;
      return ` - ${workflow.name}: ${record?.id || "missing"}`;
    }).join("\n");

    log("");
    log("Deployment complete.");
    log(`Backups saved to: ${backupDir}`);
    log("Workflows:");
    log(summary);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
