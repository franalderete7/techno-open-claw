import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const currentDir = dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  resolve(process.cwd(), ".env"),
  resolve(currentDir, "../../.env"),
];

for (const envPath of envCandidates) {
  if (!existsSync(envPath)) {
    continue;
  }

  dotenv.config({ path: envPath });
  break;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
};

export default nextConfig;
