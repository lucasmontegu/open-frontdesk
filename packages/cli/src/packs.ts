import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { invalidPolicyRules } from "@ofd/evals";
import { BUILTIN_PACKS_DIR, getBuiltinPack, loadPack, type Pack, PackError } from "@ofd/packs";
import { parse, stringify } from "yaml";

/** A builtin pack id or a pack directory. A directory wins when it exists, so `./cobranza-ar` can be a local fork. */
export function resolvePack(idOrDir: string): Pack | null {
  const dir = resolve(idOrDir);
  if (existsSync(join(dir, "pack.yaml"))) return loadPack(dir);
  return getBuiltinPack(idOrDir);
}

/** Loads the pack (schema errors surface as PackError) and checks that every policy rule compiles. Returns problems. */
export function validatePackDir(dir: string): { pack: Pack | null; problems: string[] } {
  let pack: Pack;
  try {
    pack = loadPack(resolve(dir));
  } catch (e) {
    if (e instanceof PackError) return { pack: null, problems: [e.message] };
    throw e;
  }
  const problems: string[] = [];
  for (const bad of invalidPolicyRules(pack.policies))
    problems.push(`policies.yaml: la regla "${bad.ruleId}" no compila: ${bad.error}`);
  const seen = new Set<string>();
  for (const s of pack.scenarios) {
    if (seen.has(s.id)) problems.push(`scenarios: id duplicado "${s.id}"`);
    seen.add(s.id);
  }
  return { pack, problems };
}

const TEMPLATE = "recepcion-ar";

/** Copies the recepcion-ar pack into `dir` and renames it after the directory. Returns the new pack id. */
export function scaffoldPack(
  dir: string,
): { id: string } | { error: "exists" | "bad_id"; id: string } {
  const target = resolve(dir);
  const id = basename(target);
  if (!/^[a-z0-9-]+$/.test(id)) return { error: "bad_id", id };
  if (existsSync(target) && (!statSync(target).isDirectory() || readdirSync(target).length > 0))
    return { error: "exists", id };

  mkdirSync(target, { recursive: true });
  cpSync(join(BUILTIN_PACKS_DIR, TEMPLATE), target, { recursive: true });
  const manifestPath = join(target, "pack.yaml");
  const manifest = parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  manifest["id"] = id;
  manifest["version"] = "0.1.0";
  manifest["name"] = id;
  const bot = manifest["defaultBot"] as Record<string, unknown> | undefined;
  if (bot) delete bot["pack"];
  writeFileSync(manifestPath, stringify(manifest, { lineWidth: 0 }));
  return { id };
}
