import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @type {import('next').NextConfig} */
export default {
  output: "standalone",
  // Monorepo: trace files from the repo root so the standalone bundle includes workspace deps.
  outputFileTracingRoot: root,
};
