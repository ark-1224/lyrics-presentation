import { describe, expect, it } from "vitest";
import { checkVideoFile, formatBytes } from "../client/src/format";
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

describe("upload checks", () => {
  it("formats file sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(442702)).toBe("432 KB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50.0 MB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.50 GB");
  });

  it("accepts mp4/webm within the limit, in any letter case", () => {
    expect(checkVideoFile({ name: "loop.mp4", size: 1000 }, 500)).toBeNull();
    expect(checkVideoFile({ name: "LOOP.WEBM", size: 1000 }, 500)).toBeNull();
    expect(checkVideoFile({ name: "loop.mp4", size: 500 * 1024 * 1024 }, 500)).toBeNull(); // exactly at the limit
  });

  it("explains why a file is refused", () => {
    expect(checkVideoFile({ name: "clip.mov", size: 1000 }, 500)).toMatch(/Only \.mp4 and \.webm/);
    expect(checkVideoFile({ name: "notes.txt", size: 10 }, 500)).toMatch(/isn't supported/);
    const tooBig = checkVideoFile({ name: "huge.mp4", size: 600 * 1024 * 1024 }, 500);
    expect(tooBig).toContain("600.0 MB");
    expect(tooBig).toContain("500 MB limit");
  });
});
