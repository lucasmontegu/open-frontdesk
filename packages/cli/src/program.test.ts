import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReleaseGate } from "@ofd/evals";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run, type CliDeps } from "./program.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "ofd-cli-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function harness(env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    env,
    runGate: runReleaseGate,
    migrate: vi.fn(async () => {}),
    seed: vi.fn(async () => ({ contacts: 10, obligations: 20, docs: 3 })),
  };
  return { out, err, deps };
}

describe("ofd eval", () => {
  it("passes level 1 for cobranza-ar", async () => {
    const h = harness();
    expect(await run(["eval", "cobranza-ar"], h.deps)).toBe(0);
    const text = h.out.join("\n");
    expect(text).toContain("cobranza-ar: APROBADO");
    expect(text).toContain("Nivel 1 (política): ok");
    expect(text).toContain("Nivel 2 (conversación): omitido");
  });

  it("prints English with --lang en", async () => {
    const h = harness();
    expect(await run(["--lang", "en", "eval", "ventas-ar"], h.deps)).toBe(0);
    expect(h.out.join("\n")).toContain("ventas-ar: PASSED");
  });

  it("passes the model through to the conversation level", async () => {
    const h = harness();
    const runGate = vi.fn(async () => ({ passed: true, score: 1, summary: "ok", failures: [], levels: { policy: "passed" as const, conversation: "passed" as const } }));
    expect(await run(["eval", "cobranza-ar", "--model", "openai/gpt-5-mini"], { ...h.deps, runGate })).toBe(0);
    expect(runGate.mock.calls[0]![0].conversation).toMatchObject({ model: "openai/gpt-5-mini" });
  });

  it("exits 1 and lists failures when the gate fails", async () => {
    const dir = join(tmp(), "mala-ar");
    const h = harness();
    expect(await run(["init", dir], h.deps)).toBe(0);
    writeFileSync(join(dir, "policies.yaml"), "- id: solo-lectura\n  effect: allow\n  description: x\n  when: tool.effect == 'read'\n");
    h.out.length = 0;
    expect(await run(["eval", dir], h.deps)).toBe(1);
    expect(h.out.join("\n")).toContain("RECHAZADO");
    expect(h.out.join("\n")).toContain("Fallas:");
  });

  it("exits 1 for an unknown pack", async () => {
    const h = harness();
    expect(await run(["eval", "no-existe"], h.deps)).toBe(1);
    expect(h.err.join("\n")).toContain("no-existe");
  });

  it("requires the pack argument", async () => {
    const h = harness();
    expect(await run(["eval"], h.deps)).toBe(1);
  });
});

describe("ofd packs", () => {
  it("lists the builtin packs", async () => {
    const h = harness();
    expect(await run(["packs", "list"], h.deps)).toBe(0);
    const text = h.out.join("\n");
    for (const id of ["cobranza-ar", "recepcion-ar", "ventas-ar"]) expect(text).toContain(id);
  });

  it("validates a good pack and reports a broken one", async () => {
    const h = harness();
    const dir = join(tmp(), "mi-pack");
    await run(["init", dir], h.deps);
    expect(await run(["packs", "validate", dir], h.deps)).toBe(0);
    expect(h.out.join("\n")).toContain('Pack "mi-pack" válido');

    writeFileSync(join(dir, "policies.yaml"), "- id: rota\n  effect: deny\n  when: tool.effect ==\n");
    const h2 = harness();
    expect(await run(["packs", "validate", dir], h2.deps)).toBe(1);
    expect(h2.err.join("\n")).toContain("rota");
  });

  it("reports a pack with a missing manifest", async () => {
    const h = harness();
    expect(await run(["packs", "validate", tmp()], h.deps)).toBe(1);
    expect(h.err.join("\n")).toContain("pack.yaml");
  });
});

describe("ofd init", () => {
  it("scaffolds a pack named after the directory, and refuses to overwrite", async () => {
    const dir = join(tmp(), "clinica-sur");
    const h = harness();
    expect(await run(["init", dir], h.deps)).toBe(0);
    expect(existsSync(join(dir, "scenarios"))).toBe(true);
    expect(readFileSync(join(dir, "pack.yaml"), "utf8")).toMatch(/^id: clinica-sur$/m);
    expect(await run(["eval", dir], harness().deps)).toBe(0);
    expect(await run(["init", dir], harness().deps)).toBe(1);
  });

  it("rejects a directory name that cannot be a pack id", async () => {
    expect(await run(["init", join(tmp(), "Mi Pack")], harness().deps)).toBe(1);
  });
});

describe("ofd migrate and seed", () => {
  it("need DATABASE_URL", async () => {
    const h = harness();
    expect(await run(["migrate"], h.deps)).toBe(1);
    expect(await run(["seed"], h.deps)).toBe(1);
    expect(h.deps.migrate).not.toHaveBeenCalled();
  });

  it("call the db with the url from the environment", async () => {
    const h = harness({ DATABASE_URL: "postgres://x" });
    expect(await run(["migrate"], h.deps)).toBe(0);
    expect(h.deps.migrate).toHaveBeenCalledWith("postgres://x");
    expect(h.out.join("\n")).toContain("ofd seed");
    expect(await run(["seed", "--org", "org_x"], h.deps)).toBe(0);
    expect(h.deps.seed).toHaveBeenCalledWith("postgres://x", "org_x");
    expect(h.out.join("\n")).toContain("10 contactos");
  });
});

describe("argument parsing", () => {
  it("rejects unknown commands and bad --lang", async () => {
    expect(await run(["bogus"], harness().deps)).toBe(1);
    expect(await run(["--lang", "fr", "packs", "list"], harness().deps)).toBe(1);
  });
});
