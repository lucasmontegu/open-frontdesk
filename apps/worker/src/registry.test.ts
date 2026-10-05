import type { JobName } from "@ofd/core";
import { describe, expect, it } from "vitest";
import { createHandlers, type HandlerDeps, registerHandlers } from "./registry.js";

describe("registry", () => {
  it("registers a handler for every job name", async () => {
    const handlers = createHandlers({} as HandlerDeps);
    const registered: string[] = [];
    const names = await registerHandlers(
      {
        work: async (name: JobName) => {
          registered.push(name);
          return "id";
        },
      },
      handlers,
    );
    expect(new Set(names)).toEqual(
      new Set([
        "mission.plan",
        "mission.execute",
        "mission.contact",
        "conversation.extract_facts",
        "goal.tick",
        "crm.sync",
      ]),
    );
    expect(registered).toHaveLength(6);
  });
});
