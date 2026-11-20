import type { DeckOptions } from "./pptx-builder.js";

/**
 * The sample presentation used by tests and written to tests/fixtures/sample.pptx
 * (run `npm run fixtures` to regenerate it). Six slides in show order:
 *  1. title + body, with line breaks, a footer and slide number (both must be ignored), and notes
 *  2. a plain text box with two paragraphs, no notes
 *  3. EMPTY: only a picture (with alt text) and a slide number
 *  4. blank-line separated paragraphs, two-paragraph notes
 *  5. HIDDEN in PowerPoint
 *  6. special characters, notes page that also carries a slide number
 * File names are stored in reverse, so slide1.xml is NOT the first slide in the show.
 */
export const SAMPLE_DECK: DeckOptions = {
  reverseFileNames: true,
  slides: [
    {
      shapes: [
        { kind: "title", paragraphs: ["Amazing Grace"] },
        { kind: "body", paragraphs: ["Amazing grace, how sweet the sound\nThat saved a wretch like me"] },
        { kind: "ftr", paragraphs: ["Grace Community Church"] },
        { kind: "sldNum" },
      ],
      notes: ["Start soft, piano only"],
    },
    { shapes: [{ paragraphs: ["I once was lost, but now am found", "Was blind, but now I see"] }] },
    { shapes: [{ kind: "sldNum" }], picture: true },
    {
      shapes: [{ paragraphs: ["'Twas grace that taught my heart to fear", "", "And grace my fears relieved"] }],
      notes: ["Band comes in here", "Cue the lights"],
    },
    { shapes: [{ paragraphs: ["Skipped verse (hidden in PowerPoint)"] }], hidden: true },
    {
      shapes: [{ paragraphs: ["Chorus: Praise & worship — ♪", "1984 <3 \"quotes\" 'apostrophe'"] }],
      notes: ["Repeat twice"],
      notesSlideNumber: true,
    },
  ],
};
