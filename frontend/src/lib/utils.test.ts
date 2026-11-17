import { fmtDays, initials, num } from "./utils";

describe("formatters", () => {
  it("formats day counts from decimal strings without float noise", () => {
    expect(fmtDays("1.50")).toBe("1.5");
    expect(fmtDays("2.00")).toBe("2");
    expect(fmtDays("0.25")).toBe("0.25");
    expect(fmtDays("1.50", { signed: true })).toBe("+1.5");
    expect(fmtDays(null)).toBe("0");
  });
  it("parses decimals and initials", () => {
    expect(num("0.50")).toBe(0.5);
    expect(initials("Shraddha  Rajeshirke Patil")).toBe("SR");
  });
});
