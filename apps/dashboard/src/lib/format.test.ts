import { describe, expect, it } from "vitest";
import { formatArs, formatDate, formatDateTime, formatMinutes, formatPhone, isSameDayAr } from "./format";

describe("formatArs", () => {
  it("uses Argentine separators", () => {
    expect(formatArs(1234567.5)).toBe("$ 1.234.567,50");
  });
  it("supports USD", () => {
    expect(formatArs(10, "USD")).toContain("10,00");
  });
});

describe("dates", () => {
  it("formats in Buenos Aires time", () => {
    expect(formatDate("2026-03-05T02:30:00Z")).toBe("04/03/2026");
    expect(formatDateTime("2026-03-05T15:07:00Z")).toBe("05/03/2026 12:07");
  });
  it("returns empty for invalid input", () => {
    expect(formatDate("nope")).toBe("");
  });
  it("compares days in Buenos Aires", () => {
    const now = new Date("2026-03-05T12:00:00Z");
    expect(isSameDayAr("2026-03-05T03:30:00Z", now)).toBe(true);
    expect(isSameDayAr("2026-03-05T02:30:00Z", now)).toBe(false);
  });
});

describe("formatPhone", () => {
  it("formats Buenos Aires mobiles", () => {
    expect(formatPhone("+5491112345678")).toBe("+54 9 11 1234-5678");
  });
  it("formats interior mobiles", () => {
    expect(formatPhone("5493511234567")).toBe("+54 9 351 123-4567");
  });
  it("leaves unknown formats alone", () => {
    expect(formatPhone("12345")).toBe("12345");
  });
});

describe("formatMinutes", () => {
  it("formats", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(95)).toBe("1 h 35 min");
  });
});
