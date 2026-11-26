import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { MAX_SECTION_NAME, SECTIONS, isCustomSection, sectionFromName } from "../../shared/types";
import type { CustomSection, SectionId, SlideSection } from "../../shared/types";
import { sectionLabel } from "./sections";

/** Menu entry that opens the name box. It is never stored. */
const NEW_NAME = "new-name";

interface Props {
  section: SlideSection;
  slideNumber: number;
  /** How many slides in this song carry the same section. */
  sharedBy: number;
  /** Label this slide only. */
  onSet: (section: SlideSection) => void;
  /** Rename a custom section on every slide that carries it. */
  onRename: (from: CustomSection, to: SectionId) => void;
}

/**
 * The section menu on a slide card: the built-in sections, plus "Custom name…" to type your own.
 * A slide with a custom name also gets a Rename button.
 */
export function SectionPicker({ section, slideNumber, sharedBy, onSet, onRename }: Props) {
  // What the name box is for, or null while the menu is showing.
  const [naming, setNaming] = useState<"set" | "rename" | null>(null);
  const [draft, setDraft] = useState("");
  const menu = useRef<HTMLSelectElement>(null);
  const restoreFocus = useRef(false);
  const custom = isCustomSection(section) ? section : null;
  const named = sectionFromName(draft);

  // Put keyboard focus back on the menu after the name box closes.
  useEffect(() => {
    if (naming === null && restoreFocus.current) {
      restoreFocus.current = false;
      menu.current?.focus();
    }
  }, [naming]);

  function open(purpose: "set" | "rename") {
    setDraft(purpose === "rename" ? sectionLabel(section) : "");
    setNaming(purpose);
  }
  function close() {
    restoreFocus.current = true;
    setNaming(null);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!named) return;
    if (naming === "rename" && custom) {
      if (named !== custom) onRename(custom, named);
    } else {
      onSet(named);
    }
    close();
  }

  if (naming !== null) {
    return (
      <form className="section-name" onSubmit={submit}>
        <input
          value={draft}
          maxLength={MAX_SECTION_NAME}
          placeholder="Section name"
          aria-label={naming === "rename" ? `New name for ${sectionLabel(section)}` : `Custom section name for slide ${slideNumber}`}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && close()}
        />
        <button type="submit" className="primary" disabled={!named}>
          {naming === "rename" && sharedBy > 1 ? `Rename ${sharedBy} slides` : "Save"}
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </form>
    );
  }

  return (
    <>
      <select
        ref={menu}
        className="section-select"
        value={section}
        aria-label={`Section of slide ${slideNumber}`}
        title="Label this slide so you can jump to it from the Live panel"
        onChange={(e) => (e.target.value === NEW_NAME ? open("set") : onSet(e.target.value as SlideSection))}
      >
        <option value="">No section</option>
        {SECTIONS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
        {custom && <option value={custom}>{sectionLabel(custom)}</option>}
        <option value={NEW_NAME}>Custom name…</option>
      </select>
      {custom && (
        <button type="button" onClick={() => open("rename")} title="Change this name on every slide in this song that uses it">
          Rename
        </button>
      )}
    </>
  );
}
