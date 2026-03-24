#!/usr/bin/env node

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(rootDir, "n8n");
const outputDir = resolve(sourceDir, "v18");

const workflowNameMap = new Map([
  ["TechnoStore - AI Sales Agent v17", "TechnoStore - AI Sales Agent v18"],
  ["TechnoStore - v17 Context Builder", "TechnoStore - v18 Context Builder"],
  ["TechnoStore - v17 Router", "TechnoStore - v18 Router"],
  ["TechnoStore - v17 Info Responder", "TechnoStore - v18 Info Responder"],
  ["TechnoStore - v17 Sales Responder", "TechnoStore - v18 Sales Responder"],
  ["TechnoStore - v17 Validator", "TechnoStore - v18 Validator"],
  ["TechnoStore - v17 State Update", "TechnoStore - v18 State Update"],
]);

const stringReplacements = [
  ["TechnoStore - AI Sales Agent v17", "TechnoStore - AI Sales Agent v18"],
  ["TechnoStore - v17 Context Builder", "TechnoStore - v18 Context Builder"],
  ["TechnoStore - v17 Router", "TechnoStore - v18 Router"],
  ["TechnoStore - v17 Info Responder", "TechnoStore - v18 Info Responder"],
  ["TechnoStore - v17 Sales Responder", "TechnoStore - v18 Sales Responder"],
  ["TechnoStore - v17 Validator", "TechnoStore - v18 Validator"],
  ["TechnoStore - v17 State Update", "TechnoStore - v18 State Update"],
  ["techno-sales-v17", "techno-sales-v18"],
  ["$env.SUPABASE_URL", "$env.OPENCLAW_API_BASE_URL"],
  ["$env.SUPABASE_KEY", "$env.OPENCLAW_API_TOKEN"],
  ["workflow_version: 'v17'", "workflow_version: 'v18'"],
];

function replaceAll(value) {
  let next = value;

  for (const [from, to] of stringReplacements) {
    next = next.split(from).join(to);
  }

  return next;
}

function transform(value) {
  if (typeof value === "string") {
    return replaceAll(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => transform(entry));
  }

  if (value && typeof value === "object") {
    const output = {};

    for (const [key, entryValue] of Object.entries(value)) {
      output[key] = transform(entryValue);
    }

    return output;
  }

  return value;
}

function cleanHttpHeaders(workflow) {
  for (const node of workflow.nodes ?? []) {
    if (node?.type !== "n8n-nodes-base.httpRequest") {
      continue;
    }

    const parameters = node.parameters ?? {};
    const headerBlock = parameters.headerParameters;
    const headerParameters = headerBlock?.parameters;

    if (!Array.isArray(headerParameters)) {
      continue;
    }

    const nextHeaders = headerParameters
      .filter((header) => String(header?.name || "").toLowerCase() !== "apikey")
      .map((header) => {
        if (String(header?.name || "").toLowerCase() === "authorization") {
          return {
            ...header,
            value: "=Bearer {{ $env.OPENCLAW_API_TOKEN }}",
          };
        }

        return header;
      });

    node.parameters.headerParameters = {
      ...headerBlock,
      parameters: nextHeaders,
    };
  }
}

mkdirSync(outputDir, { recursive: true });

const files = readdirSync(sourceDir)
  .filter((file) => /^TechnoStore_v17_.*\.json$/.test(file))
  .sort();

const generated = [];

for (const file of files) {
  const inputPath = resolve(sourceDir, file);
  const raw = JSON.parse(readFileSync(inputPath, "utf8"));
  const transformed = transform(raw);

  if (workflowNameMap.has(transformed.name)) {
    transformed.name = workflowNameMap.get(transformed.name);
  }

  cleanHttpHeaders(transformed);

  const outputFile = basename(file).replace("_v17_", "_v18_");
  const outputPath = resolve(outputDir, outputFile);
  writeFileSync(outputPath, `${JSON.stringify(transformed, null, 2)}\n`);
  generated.push(outputPath);
}

console.log(JSON.stringify({ outputDir, generated }, null, 2));
