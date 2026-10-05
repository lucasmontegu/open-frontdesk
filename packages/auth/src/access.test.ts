import { describe, expect, it } from "vitest";
import { can } from "./access.js";

describe("can", () => {
  it("lets supervisors approve missions but not publish bots", () => {
    expect(can("supervisor", "missions", "approve")).toBe(true);
    expect(can("supervisor", "bots", "publish")).toBe(false);
  });

  it("keeps recordings away from viewers", () => {
    expect(can("viewer", "recordings", "read")).toBe(false);
    expect(can("viewer", "calls", "read")).toBe(true);
  });

  it("gives billing only to owners", () => {
    expect(can("owner", "billing", "update")).toBe(true);
    expect(can("admin", "billing", "read")).toBe(false);
  });
});
