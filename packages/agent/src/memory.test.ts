import { describe, expect, it } from "vitest";
import { createMemory, memoryScope } from "./memory.js";

describe("memory", () => {
  it("builds a Postgres-backed memory and scopes by contact and conversation", () => {
    const memory = createMemory({ connectionString: "postgres://ofd:ofd@localhost:5432/ofd" });
    expect(memory).toBeDefined();
    expect(memoryScope("contact1", "conv1")).toEqual({ resource: "contact1", thread: "conv1" });
  });
});
