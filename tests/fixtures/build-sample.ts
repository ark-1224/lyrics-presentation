import fs from "node:fs";
import path from "node:path";
import { buildPptx } from "./pptx-builder.js";
import { SAMPLE_DECK } from "./sample-deck.js";

// Regenerates tests/fixtures/sample.pptx from SAMPLE_DECK. Run with: npm run fixtures
const out = path.join(import.meta.dirname, "sample.pptx");
const bytes = buildPptx(SAMPLE_DECK);
fs.writeFileSync(out, bytes);
console.log(`Wrote ${out} (${bytes.length} bytes, ${SAMPLE_DECK.slides.length} slides)`);
