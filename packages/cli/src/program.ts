import { Command, CommanderError } from "commander";
import { BotConfig, type BotVersion } from "@ofd/core";
import { listBuiltinPacks, type Pack } from "@ofd/packs";
import { runReleaseGate, type EvalRunResult, type ReleaseGateInput } from "@ofd/evals";
import { messages, type Lang } from "./messages.js";
import { resolvePack, scaffoldPack, validatePackDir } from "./packs.js";

/** Everything the commands touch outside the process, so tests can replace it. */
export interface CliDeps {
  out(line: string): void;
  err(line: string): void;
  env: Record<string, string | undefined>;
  runGate(input: ReleaseGateInput): Promise<EvalRunResult>;
  migrate(databaseUrl: string): Promise<void>;
  seed(databaseUrl: string, orgId?: string): Promise<{ contacts: number; obligations: number; docs: number }>;
}

export interface CliResult {
  exitCode: number;
}

export const EVAL_ORG_ID = "org_cli_eval";

function draftVersion(pack: Pack): BotVersion {
  return {
    id: "bv_cli_draft",
    orgId: EVAL_ORG_ID,
    botId: "bot_cli_draft",
    version: 1,
    config: BotConfig.parse({ ...pack.manifest.defaultBot, pack: { id: pack.manifest.id, version: pack.manifest.version } }),
    status: "draft",
    evalRunId: null,
    createdAt: new Date(),
  };
}

export function formatGateResult(result: EvalRunResult, packId: string, lang: Lang): string[] {
  const m = messages(lang);
  const lv = (s: string) => (s === "passed" ? m.passed : s === "failed" ? m.failed : m.skipped);
  const lines = [
    `${packId}: ${result.passed ? m.gatePassed : m.gateFailed}`,
    `  ${m.level} 1 (${m.policy}): ${lv(result.levels.policy)}`,
    `  ${m.level} 2 (${m.conversation}): ${lv(result.levels.conversation)}`,
    `  ${m.score}: ${Math.round(result.score * 100)}%`,
    `  ${result.summary}`,
  ];
  if (result.failures.length > 0) {
    lines.push(`  ${m.failures}:`);
    for (const f of result.failures) lines.push(`    - ${f.scenario}: ${f.reason}`);
  }
  return lines;
}

const parseLang = (v: string): Lang => {
  if (v !== "es" && v !== "en") throw new CommanderError(1, "commander.invalidArgument", `--lang must be "es" or "en"`);
  return v;
};

export function buildProgram(deps: CliDeps, result: CliResult = { exitCode: 0 }): Command {
  const program = new Command("ofd")
    .description("OpenFrontDesk command line")
    .option("--lang <lang>", "output language: es or en", parseLang, "es" as Lang)
    .exitOverride()
    .configureOutput({ writeOut: (s) => deps.out(s.trimEnd()), writeErr: (s) => deps.err(s.trimEnd()) });
  const lang = () => program.opts<{ lang: Lang }>().lang;
  const fail = (line: string) => {
    deps.err(line);
    result.exitCode = 1;
  };

  const databaseUrl = (): string | null => {
    const url = deps.env["DATABASE_URL"];
    if (!url) fail(messages(lang()).needDb);
    return url ?? null;
  };

  program
    .command("migrate")
    .description("apply database migrations (DATABASE_URL)")
    .action(async () => {
      const url = databaseUrl();
      if (!url) return;
      await deps.migrate(url);
      deps.out(messages(lang()).migrated);
      deps.out(messages(lang()).migrateHint);
    });

  program
    .command("seed")
    .description("load demo data (DATABASE_URL)")
    .option("--org <orgId>", "organization id to seed")
    .action(async (opts: { org?: string }) => {
      const url = databaseUrl();
      if (!url) return;
      const r = await deps.seed(url, opts.org);
      deps.out(messages(lang()).seeded(r.contacts, r.obligations, r.docs));
    });

  const packs = program.command("packs").description("work with packs");
  packs
    .command("list")
    .description("list the builtin packs")
    .action(() => {
      deps.out(messages(lang()).packsHeader);
      for (const p of listBuiltinPacks()) deps.out(`${p.manifest.id}\t${p.manifest.version}\t${p.scenarios.length}\t${p.manifest.name}`);
    });
  packs
    .command("validate")
    .argument("<dir>", "pack directory")
    .description("check a pack's files, schemas and policy rules")
    .action((dir: string) => {
      const { pack, problems } = validatePackDir(dir);
      if (problems.length > 0 || !pack) {
        for (const p of problems) deps.err(p);
        result.exitCode = 1;
        return;
      }
      deps.out(messages(lang()).packOk(pack.manifest.id, pack.scenarios.length, pack.policies.length));
    });

  program
    .command("eval")
    .argument("<pack>", "builtin pack id or pack directory")
    .option("--model <id>", "also simulate conversations with this model (needs its API key)")
    .description("run the release gate on a pack's default bot")
    .action(async (packRef: string, opts: { model?: string }) => {
      const m = messages(lang());
      let pack: Pack | null;
      try {
        pack = resolvePack(packRef);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
        return;
      }
      if (!pack) return fail(m.noPack(packRef));
      const gate = await deps.runGate({
        orgId: EVAL_ORG_ID,
        botVersion: draftVersion(pack),
        scenarios: pack.scenarios,
        policies: pack.policies,
        conversation: opts.model ? { model: opts.model, botModel: opts.model } : null,
      });
      for (const line of formatGateResult(gate, pack.manifest.id, lang())) deps.out(line);
      if (!gate.passed) result.exitCode = 1;
    });

  program
    .command("init")
    .argument("<dir>", "directory for the new pack; its name becomes the pack id")
    .description("scaffold a custom pack from recepcion-ar")
    .action((dir: string) => {
      const m = messages(lang());
      const r = scaffoldPack(dir);
      if ("error" in r) return fail(r.error === "exists" ? m.initExists(dir) : m.initBadId(r.id));
      deps.out(m.initDone(dir, r.id));
    });

  return program;
}

export const defaultDeps = (): CliDeps => ({
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  env: process.env,
  runGate: runReleaseGate,
  async migrate(url) {
    const { runMigrations } = await import("@ofd/db");
    await runMigrations(url);
  },
  async seed(url, orgId) {
    const { createDb, seedDemo } = await import("@ofd/db");
    const { db, close } = createDb(url, { max: 1 });
    try {
      return await seedDemo(db, orgId);
    } finally {
      await close();
    }
  },
});

/** Runs the CLI with `argv` (without node and script) and returns the exit code. */
export async function run(argv: string[], deps: CliDeps = defaultDeps()): Promise<number> {
  const result: CliResult = { exitCode: 0 };
  const program = buildProgram(deps, result);
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode;
    deps.err(e instanceof Error ? e.message : String(e));
    return 1;
  }
  return result.exitCode;
}
