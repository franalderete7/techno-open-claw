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

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const csvPath = process.argv[2];

if (!csvPath) {
  console.error("Usage: node scripts/import-products-from-csv.mjs <csv-file>");
  process.exit(1);
}

const apiBaseUrl = process.env.TECHNO_OPEN_CLAW_API_URL || `http://127.0.0.1:${process.env.API_PORT || "4000"}`;
const apiToken = process.env.TECHNO_OPEN_CLAW_API_TOKEN || process.env.API_BEARER_TOKEN || "";

if (!apiToken) {
  console.error("Missing API token. Set API_BEARER_TOKEN in .env.");
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(field);
      field = "";

      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...records] = rows;
  return records.map((record) =>
    Object.fromEntries(header.map((key, index) => [key, record[index] ?? ""]))
  );
}

function nullIfEmpty(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" || trimmed.toLowerCase() === "null" ? null : trimmed;
}

function parseNumber(value) {
  const normalized = nullIfEmpty(value);
  if (normalized == null) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value) {
  const parsed = parseNumber(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function parseBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return false;
}

function titleCase(value) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function detectBrand(productName, category) {
  const name = String(productName || "").trim();

  if (/^iphone\b/i.test(name)) return "Apple";
  if (/^samsung\b/i.test(name)) return "Samsung";
  if (/^xiaomi\b/i.test(name)) return "Xiaomi";
  if (/^redmi\b/i.test(name)) return "Redmi";
  if (/^poco\b/i.test(name)) return "POCO";

  const categoryRoot = String(category || "")
    .split("/")
    .map((entry) => entry.trim())
    .find(Boolean);

  if (!categoryRoot) {
    return "Unknown";
  }

  if (/^iphone$/i.test(categoryRoot)) {
    return "Apple";
  }

  return titleCase(categoryRoot);
}

function detectModel(productName, brand) {
  const name = String(productName || "").trim();

  if (!name) {
    return "Unknown";
  }

  if (brand === "Apple" && /^iphone\b/i.test(name)) {
    return name;
  }

  const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = name.replace(new RegExp(`^${escapedBrand}\\s+`, "i"), "").trim();
  return stripped || name;
}

function buildDescription(row) {
  const bits = [];
  const ramGb = parseInteger(row.ram_gb);
  const storageGb = parseInteger(row.storage_gb);
  const network = nullIfEmpty(row.network);
  const color = nullIfEmpty(row.color);

  if (ramGb != null) bits.push(`${ramGb}GB RAM`);
  if (storageGb != null) bits.push(`${storageGb}GB storage`);
  if (network) bits.push(network.toUpperCase());
  if (color) bits.push(color);

  return bits.length > 0 ? bits.join(", ") : null;
}

function buildPayload(row) {
  const sku = nullIfEmpty(row.product_key);
  const title = nullIfEmpty(row.product_name);

  if (!sku || !title) {
    throw new Error(`Row is missing product_key or product_name: ${JSON.stringify(row)}`);
  }

  const brand = detectBrand(title, row.category);
  const imageUrl = nullIfEmpty(row.image_url);

  return {
    legacy_source_id: parseInteger(row.id),
    sku,
    slug: sku.replace(/_/g, "-"),
    brand,
    model: detectModel(title, brand),
    title,
    description: buildDescription(row),
    condition: nullIfEmpty(row.condition) || "new",
    price_amount: parseNumber(row.price_ars),
    currency_code: "ARS",
    active: true,
    category: nullIfEmpty(row.category),
    cost_usd: parseNumber(row.cost_usd),
    logistics_usd: parseNumber(row.logistics_usd),
    total_cost_usd: parseNumber(row.total_cost_usd),
    margin_pct: parseNumber(row.margin_pct),
    price_usd: parseNumber(row.price_usd),
    promo_price_ars: parseNumber(row.promo_price_ars),
    bancarizada_total: parseNumber(row.bancarizada_total),
    bancarizada_cuota: parseNumber(row.bancarizada_cuota),
    bancarizada_interest: parseNumber(row.bancarizada_interest),
    macro_total: parseNumber(row.macro_total),
    macro_cuota: parseNumber(row.macro_cuota),
    macro_interest: parseNumber(row.macro_interest),
    cuotas_qty: parseInteger(row.cuotas_qty),
    in_stock: parseBoolean(row.in_stock),
    delivery_type: nullIfEmpty(row.delivery_type),
    delivery_days: parseInteger(row.delivery_days),
    usd_rate: parseNumber(row.usd_rate),
    image_url: imageUrl,
    ram_gb: parseInteger(row.ram_gb),
    storage_gb: parseInteger(row.storage_gb),
    network: nullIfEmpty(row.network),
    color: nullIfEmpty(row.color),
    battery_health: parseInteger(row.battery_health),
  };
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

const csvText = readFileSync(resolve(csvPath), "utf8");
const rows = parseCsv(csvText);
const existing = await apiFetch("/v1/products?limit=200");
const existingBySku = new Map(existing.items.map((item) => [item.sku, item]));
const tempDir = resolve("/tmp", "techno-open-claw-product-payloads");
mkdirSync(tempDir, { recursive: true });

let created = 0;
let updated = 0;

for (const row of rows) {
  const payload = buildPayload(row);
  const existingProduct = existingBySku.get(payload.sku);
  const payloadPath = resolve(tempDir, `${payload.sku}.json`);
  writeFileSync(payloadPath, `${JSON.stringify(payload, null, 2)}\n`);

  if (existingProduct) {
    await apiFetch(`/v1/products/${existingProduct.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    updated += 1;
  } else {
    const createdProduct = await apiFetch("/v1/products", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    existingBySku.set(createdProduct.sku, createdProduct);
    created += 1;
  }
}

console.log(
  JSON.stringify(
    {
      source: basename(csvPath),
      rows: rows.length,
      created,
      updated,
      payloadDir: tempDir,
    },
    null,
    2
  )
);
