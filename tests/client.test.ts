import { describe, expect, it } from "vitest";
import { reconnectDelay } from "../client/src/socket";
import { isTypingTarget, shortcutFor } from "../client/src/shortcuts";
import { textStyle } from "../client/src/DisplayView";
import { DEFAULT_SETTINGS } from "../shared/types";

describe("keyboard shortcuts", () => {
  it("maps keys to live actions", () => {
    for (const key of ["ArrowRight", "ArrowDown", "PageDown", " "]) expect(shortcutFor({ key })).toBe("next");
    for (const key of ["ArrowLeft", "ArrowUp", "PageUp"]) expect(shortcutFor({ key })).toBe("prev");
    expect(shortcutFor({ key: "b" })).toBe("blank");
    expect(shortcutFor({ key: "B" })).toBe("blank");
    expect(shortcutFor({ key: "x" })).toBeNull();
    expect(shortcutFor({ key: "Enter" })).toBeNull();
  });

  it("stays out of the way while typing", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) {
      expect(shortcutFor({ key: " ", target: { tagName } })).toBeNull();
      expect(shortcutFor({ key: "b", target: { tagName } })).toBeNull();
      expect(shortcutFor({ key: "ArrowLeft", target: { tagName } })).toBeNull();
    }
    expect(shortcutFor({ key: "b", target: { tagName: "DIV", isContentEditable: true } })).toBeNull();
    expect(shortcutFor({ key: "b", target: { tagName: "DIV" } })).toBe("blank");
    expect(shortcutFor({ key: " ", target: { tagName: "BUTTON" } })).toBe("next");
    expect(isTypingTarget(null)).toBe(false);
  });

  it("ignores browser shortcuts and held-down keys", () => {
    expect(shortcutFor({ key: "b", ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: "ArrowLeft", altKey: true })).toBeNull(); // browser Back
    expect(shortcutFor({ key: "b", metaKey: true })).toBeNull();
    expect(shortcutFor({ key: "ArrowRight", repeat: true })).toBeNull(); // holding a key must not skip through the song
  });
});

describe("reconnect backoff", () => {
  it("grows then caps at about 5 seconds", () => {
    const base = (attempt: number) => reconnectDelay(attempt);
    expect(base(0)).toBeGreaterThanOrEqual(500);
    expect(base(0)).toBeLessThan(800);
    expect(base(2)).toBeGreaterThanOrEqual(2000);
    for (const attempt of [4, 10, 50]) {
      expect(base(attempt)).toBeGreaterThanOrEqual(5000);
      expect(base(attempt)).toBeLessThan(5300);
    }
  });
});

describe("display text style", () => {
  it("uses screen-relative units so it scales from 1080p to 4K", () => {
    const css = textStyle(DEFAULT_SETTINGS.main);
    expect(css.fontSize).toBe("7cqh");
    expect(String(css.top)).toContain("cqh");
    expect(String(css.left)).toContain("cqw");
  });

  it("places the text block between the top and bottom margins", () => {
    expect(textStyle({ ...DEFAULT_SETTINGS.main, vertical: 0 }).top).toBe("4cqh");
    expect(textStyle({ ...DEFAULT_SETTINGS.main, vertical: 100 }).top).toBe("96cqh");
    expect(textStyle({ ...DEFAULT_SETTINGS.main, vertical: 50 }).transform).toBe("translateY(-50%)");
  });

  it("only draws a text outline when shadow strength is above zero", () => {
    expect(textStyle({ ...DEFAULT_SETTINGS.main, shadow: 0 }).textShadow).toBe("none");
    expect(String(textStyle({ ...DEFAULT_SETTINGS.main, shadow: 6 }).textShadow)).toContain("rgba(0,0,0,0.9)");
  });
});
