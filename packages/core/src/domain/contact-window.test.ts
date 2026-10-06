import { describe, expect, it } from "vitest";
import { ContactWindow, nextContactTime } from "./contact-window.js";

// Buenos Aires is UTC-3 all year.
const ba: ContactWindow = {
  timezone: "America/Argentina/Buenos_Aires",
  rules: [{ days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "20:00" }],
};

describe("nextContactTime", () => {
  it("returns the same instant inside the window", () => {
    const at = new Date("2026-10-06T15:30:00Z"); // Tue 12:30 local
    expect(nextContactTime(ba, at)).toEqual(at);
  });

  it("waits for the opening on the same morning", () => {
    expect(nextContactTime(ba, new Date("2026-10-06T08:00:00Z"))).toEqual(
      new Date("2026-10-06T12:00:00Z"), // Tue 05:00 local -> 09:00
    );
  });

  it("moves to the next day after closing time", () => {
    expect(nextContactTime(ba, new Date("2026-10-06T23:30:00Z"))).toEqual(
      new Date("2026-10-07T12:00:00Z"), // Tue 20:30 local -> Wed 09:00
    );
  });

  it("skips days outside the window", () => {
    expect(nextContactTime(ba, new Date("2026-10-11T15:00:00Z"))).toEqual(
      new Date("2026-10-12T12:00:00Z"), // Sun noon -> Mon 09:00
    );
  });

  it("treats the end time as closed", () => {
    expect(nextContactTime(ba, new Date("2026-10-06T23:00:00Z"))).toEqual(
      new Date("2026-10-07T12:00:00Z"), // Tue 20:00 local
    );
  });

  it("handles a timezone with daylight saving time", () => {
    const ny: ContactWindow = {
      timezone: "America/New_York",
      rules: [{ days: [1], start: "09:00", end: "17:00" }],
    };
    // US DST ends Sun 2026-11-01; Monday 09:00 EST is 14:00 UTC.
    expect(nextContactTime(ny, new Date("2026-10-31T12:00:00Z"))).toEqual(
      new Date("2026-11-02T14:00:00Z"),
    );
  });

  it("combines rules with different hours per day", () => {
    const mx: ContactWindow = {
      timezone: "America/Mexico_City", // UTC-6, no DST since 2022
      rules: [
        { days: [1, 2, 3, 4, 5], start: "07:00", end: "22:00" },
        { days: [6], start: "09:00", end: "14:00" },
      ],
    };
    // Sat 2026-10-10 15:00 local is past Saturday's hours: next is Mon 07:00.
    expect(nextContactTime(mx, new Date("2026-10-10T21:00:00Z"))).toEqual(
      new Date("2026-10-12T13:00:00Z"),
    );
    // Fri 23:00 local: Saturday 09:00 opens before Monday.
    expect(nextContactTime(mx, new Date("2026-10-10T05:00:00Z"))).toEqual(
      new Date("2026-10-10T15:00:00Z"),
    );
    // Sat 10:00 local is inside the Saturday rule.
    const sat = new Date("2026-10-10T16:00:00Z");
    expect(nextContactTime(mx, sat)).toEqual(sat);
  });

  it("rejects a rule that ends before it starts and an unknown timezone", () => {
    const rule = { days: [1], start: "20:00", end: "09:00" };
    expect(ContactWindow.safeParse({ ...ba, rules: [rule] }).success).toBe(false);
    expect(ContactWindow.safeParse({ ...ba, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(ContactWindow.safeParse({ ...ba, rules: [] }).success).toBe(false);
  });
});
