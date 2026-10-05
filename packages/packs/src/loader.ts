import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { z } from "zod";
import { EvalScenario, type Pack, PackManifest, PolicyFile } from "./schema.js";

/** Resolved from the package root, so it works from both src/ and dist/. */
export const BUILTIN_PACKS_DIR = fileURLToPath(new URL("../packs/", import.meta.url));

export class PackError extends Error {
  constructor(
    public readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = "PackError";
  }
}

function readYaml<S extends z.ZodType>(file: string, schema: S): z.infer<S> {
  let raw: unknown;
  try {
    raw = parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new PackError(file, e instanceof Error ? e.message : String(e));
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new PackError(file, detail);
  }
  return result.data;
}

export function loadPack(dir: string): Pack {
  const manifest = readYaml(join(dir, "pack.yaml"), PackManifest);
  if (manifest.id !== basename(dir)) {
    throw new PackError(
      join(dir, "pack.yaml"),
      `id: "${manifest.id}" must match the directory name "${basename(dir)}"`,
    );
  }
  const policies = readYaml(join(dir, "policies.yaml"), PolicyFile);
  const scenariosDir = join(dir, "scenarios");
  const files = readdirSync(scenariosDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
  const scenarios = files.map((f) => readYaml(join(scenariosDir, f), EvalScenario));
  const ids = new Set<string>();
  for (const rule of policies) {
    if (ids.has(rule.id))
      throw new PackError(join(dir, "policies.yaml"), `id: duplicate rule id "${rule.id}"`);
    ids.add(rule.id);
  }
  return { manifest, policies, scenarios };
}

export function listBuiltinPacks(root: string = BUILTIN_PACKS_DIR): Pack[] {
  return readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .sort()
    .map((name) => loadPack(join(root, name)));
}

export function getBuiltinPack(id: string, root: string = BUILTIN_PACKS_DIR): Pack | null {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  try {
    statSync(join(root, id, "pack.yaml"));
  } catch {
    return null;
  }
  return loadPack(join(root, id));
}
