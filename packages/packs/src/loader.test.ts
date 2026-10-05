import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_PACKS_DIR,
  getBuiltinPack,
  listBuiltinPacks,
  loadPack,
  PackError,
} from "./index.js";

describe("builtin packs", () => {
  const packs = listBuiltinPacks();

  it("ships the three certified packs", () => {
    expect(packs.map((p) => p.manifest.id)).toEqual(["cobranza-ar", "recepcion-ar", "ventas-ar"]);
    expect(getBuiltinPack("ventas-ar")?.manifest.name).toBe("Ventas Argentina");
    expect(getBuiltinPack("nope")).toBeNull();
    expect(getBuiltinPack("../etc")).toBeNull();
  });

  for (const pack of packs) {
    describe(pack.manifest.id, () => {
      it("has a valid bot, policies and scenarios", () => {
        expect(pack.manifest.defaultBot.tools).toContain("transfer_to_human");
        expect(pack.manifest.defaultBot.language).toBe("es-AR");
        expect(pack.policies.some((r) => r.effect === "allow")).toBe(true);
        expect(pack.policies.some((r) => r.effect === "deny")).toBe(true);
        expect(pack.scenarios.length).toBeGreaterThanOrEqual(3);
      });

      it("policy expressions are non-empty with balanced brackets", () => {
        for (const rule of pack.policies) {
          expect(rule.when.trim()).not.toBe("");
          const count = (c: string) => rule.when.split(c).length - 1;
          expect(count("(")).toBe(count(")"));
          expect(count("[")).toBe(count("]"));
        }
      });

      it("scenario tool assertions reference the pack's tools", () => {
        for (const s of pack.scenarios) {
          for (const a of s.assertions) {
            if (a.type === "tool_called" || a.type === "tool_not_called") {
              expect(pack.manifest.defaultBot.tools, `${s.id}: ${a.value}`).toContain(a.value);
            }
            if (a.type === "event_present" || a.type === "event_absent") {
              expect(a.value).toMatch(/^[a-z_]+\.[a-z_]+$/);
            }
          }
        }
      });
    });
  }

  it("resolves the packs directory next to package.json", () => {
    expect(BUILTIN_PACKS_DIR.endsWith("/packages/packs/packs/")).toBe(true);
  });
});

describe("validation errors", () => {
  function copyPack() {
    const root = mkdtempSync(join(tmpdir(), "ofd-pack-"));
    const dir = join(root, "cobranza-ar");
    cpSync(join(BUILTIN_PACKS_DIR, "cobranza-ar"), dir, { recursive: true });
    return dir;
  }

  it("names the file and field of a bad scenario", () => {
    const dir = copyPack();
    writeFileSync(
      join(dir, "scenarios", "roto.yaml"),
      "id: roto\ntitle: x\npersona: y\ngoal: z\ncontact: { displayName: A }\nassertions:\n  - { type: nope, value: v }\n",
    );
    try {
      loadPack(dir);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PackError);
      expect((e as Error).message).toContain("roto.yaml");
      expect((e as Error).message).toContain("assertions.0.type");
    }
  });

  it("rejects an id that does not match its directory", () => {
    const dir = copyPack();
    const other = join(dir, "..", "otro");
    mkdirSync(other);
    cpSync(dir, other, { recursive: true });
    expect(() => loadPack(other)).toThrow(/pack\.yaml.*id/);
  });

  it("rejects a malformed policy", () => {
    const dir = copyPack();
    writeFileSync(join(dir, "policies.yaml"), "- id: a\n  effect: maybe\n  when: 'true'\n");
    expect(() => loadPack(dir)).toThrow(/policies\.yaml: 0\.effect/);
  });
});
