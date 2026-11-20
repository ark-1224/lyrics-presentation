export type ShortcutAction = "next" | "prev" | "blank";

/** The shortcut legend shown on the control panel. Kept next to the logic so they can't drift apart. */
export const SHORTCUT_HELP: { keys: string; label: string }[] = [
  { keys: "→  ↓  Space  PgDn", label: "Next slide" },
  { keys: "←  ↑  PgUp", label: "Previous slide" },
  { keys: "B", label: "Blank / show text" },
  { keys: "Esc", label: "Leave a text box to use shortcuts again" },
];

interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

/** True when the user is typing somewhere, so plain keys must keep their normal meaning. */
export function isTypingTarget(target: KeyLike["target"]): boolean {
  const tag = target?.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable === true;
}

/** Map a key press to a live action, or null if it isn't one of ours. Pure, so it is easy to test. */
export function shortcutFor(e: KeyLike): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return null; // browser shortcuts, and held-down keys
  if (isTypingTarget(e.target)) return null;
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
      return "next";
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
      return "prev";
    case "b":
    case "B":
      return "blank";
    default:
      return null;
  }
}
