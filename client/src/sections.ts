import { CUSTOM_PREFIX, SECTIONS, isCustomSection } from "../../shared/types";
import type { SectionId, SlideSection } from "../../shared/types";

/** "chorus" -> "Chorus", "custom:Refrain" -> "Refrain", "" -> "". */
export function sectionLabel(section: SlideSection): string {
  if (isCustomSection(section)) return section.slice(CUSTOM_PREFIX.length);
  return SECTIONS.find((s) => s.key === section)?.label ?? "";
}

/** How many colours custom sections share (the .sec-custom-N rules in styles.css). */
export const CUSTOM_COLORS = 6;

/**
 * The CSS class that colours a section. A custom name's colour is worked out from the name itself,
 * so it is the same on every screen and after every restart, with nothing extra to store.
 */
export function sectionClass(section: SlideSection): string {
  if (!isCustomSection(section)) return section && `sec-${section}`;
  let hash = 0;
  for (const ch of sectionLabel(section).toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return `sec-custom-${hash % CUSTOM_COLORS}`;
}

export interface SectionButton {
  key: SectionId;
  label: string;
  /** How many slides carry this section (a chorus that repeats shows "×3"). */
  count: number;
}

/** One jump button per section used in the song, in the order they first appear in it. */
export function sectionButtons(slides: { section: SlideSection }[]): SectionButton[] {
  const found = new Map<SectionId, number>();
  for (const s of slides) if (s.section !== "") found.set(s.section, (found.get(s.section) ?? 0) + 1);
  return [...found].map(([key, count]) => ({ key, label: sectionLabel(key), count }));
}
