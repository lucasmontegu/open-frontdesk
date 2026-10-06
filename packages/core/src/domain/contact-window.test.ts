import { describe, expect, it } from "vitest";
import { ContactWindow, nextContactTime } from "./contact-window.js";

// Buenos Aires is UTC-3 all year.
const ba: ContactWindow = {
  timezone: "America/Argentina/Buenos_Aires",
  days: [1, 2, 3, 4, 5, 6],
  start: "09:00",
  end: "20:00",
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
      days: [1],
      start: "09:00",
      end: "17:00",
    };
    // US DST ends Sun 2026-11-01; Monday 09:00 EST is 14:00 UTC.
    expect(nextContactTime(ny, new Date("2026-10-31T12:00:00Z"))).toEqual(
      new Date("2026-11-02T14:00:00Z"),
    );
  });

  it("rejects a window that ends before it starts", () => {
    expect(ContactWindow.safeParse({ ...ba, start: "20:00", end: "09:00" }).success).toBe(false);
  });
});
