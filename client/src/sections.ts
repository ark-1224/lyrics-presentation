import { SECTIONS } from "../../shared/types";
import type { SectionKey, SlideSection } from "../../shared/types";

/** "chorus" -> "Chorus", "" -> "". */
export function sectionLabel(section: SlideSection): string {
  return SECTIONS.find((s) => s.key === section)?.label ?? "";
}

export interface SectionButton {
  key: SectionKey;
  label: string;
  /** How many slides carry this section (a chorus that repeats shows "×3"). */
  count: number;
}

/** One jump button per section used in the song, in the order they first appear in it. */
export function sectionButtons(slides: { section: SlideSection }[]): SectionButton[] {
  const found = new Map<SectionKey, number>();
  for (const s of slides) if (s.section !== "") found.set(s.section, (found.get(s.section) ?? 0) + 1);
  return [...found].map(([key, count]) => ({ key, label: sectionLabel(key), count }));
}
