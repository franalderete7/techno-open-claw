#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(rootDir, ".env");

if (existsSync(envPath)) {
  const envText = readFileSync(envPath, "utf8");

  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const jsonPath = process.argv[2];

if (!jsonPath) {
  console.error("Usage: node scripts/import-settings-from-json.mjs <json-file>");
  process.exit(1);
}

const apiBaseUrl = process.env.TECHNO_OPEN_CLAW_API_URL || `http://127.0.0.1:${process.env.API_PORT || "4000"}`;
const apiToken = process.env.TECHNO_OPEN_CLAW_API_TOKEN || process.env.API_BEARER_TOKEN || "";

if (!apiToken) {
  console.error("Missing API token. Set API_BEARER_TOKEN in .env.");
  process.exit(1);
}

function tryParseNumber(value) {
  const stringValue = String(value ?? "").trim();
  if (!stringValue) return value;
  const parsed = Number(stringValue);
  return Number.isFinite(parsed) ? parsed : value;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      "x-actor-type": "agent",
      "x-actor-id": "openclaw",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

const settings = JSON.parse(readFileSync(resolve(jsonPath), "utf8"));
if (!Array.isArray(settings)) {
  throw new Error("Expected a JSON array of settings.");
}

const payloadDir = resolve("/tmp", "techno-open-claw-setting-payloads");
mkdirSync(payloadDir, { recursive: true });

let existingStore = {};

try {
  const currentStore = await apiFetch("/v1/settings/store");
  existingStore = currentStore.value && typeof currentStore.value === "object" ? currentStore.value : {};
} catch {
  existingStore = {};
}

for (const setting of settings) {
  const payload = {
    value: tryParseNumber(setting.value),
    description: setting.description ?? null,
  };
  const payloadPath = resolve(payloadDir, `${setting.key}.json`);
  writeFileSync(payloadPath, `${JSON.stringify(payload, null, 2)}\n`);

  await apiFetch(`/v1/settings/${setting.key}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

const settingMap = new Map(settings.map((entry) => [entry.key, entry.value]));
const mergedStore = {
  ...existingStore,
  name: settingMap.get("store_location_name") || existingStore.name || "TechnoStore",
  store_location_name: settingMap.get("store_location_name") || existingStore.store_location_name || "TechnoStore",
  store_address: settingMap.get("store_address") || existingStore.store_address || null,
  store_hours: settingMap.get("store_hours") || existingStore.store_hours || null,
  store_payment_methods: settingMap.get("store_payment_methods") || existingStore.store_payment_methods || null,
  store_shipping_policy: settingMap.get("store_shipping_policy") || existingStore.store_shipping_policy || null,
  store_warranty_new: settingMap.get("store_warranty_new") || existingStore.store_warranty_new || null,
  store_warranty_used: settingMap.get("store_warranty_used") || existingStore.store_warranty_used || null,
  instagram: settingMap.get("store_social_instagram") || existingStore.instagram || null,
  facebook: settingMap.get("store_social_facebook") || existingStore.facebook || null,
  latitude: settingMap.get("store_latitude") || existingStore.latitude || null,
  longitude: settingMap.get("store_longitude") || existingStore.longitude || null,
};

await apiFetch("/v1/settings/store", {
  method: "PUT",
  body: JSON.stringify({
    value: mergedStore,
    description: "Aggregated store profile for UI and workflow fallbacks.",
  }),
});

console.log(
  JSON.stringify(
    {
      source: basename(jsonPath),
      imported: settings.length,
      payloadDir,
      storeMerged: true,
    },
    null,
    2
  )
);
