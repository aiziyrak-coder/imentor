/**
 * Saqlangan taqdimot JSON'idan PPTX yig'ish (dizayn tekshiruvi, AI'siz).
 *
 *   npx tsx scripts/render-deck-json.mts <deck.json> <out.pptx>
 */
import { readFileSync, writeFileSync } from 'node:fs';

if (typeof (globalThis as { File?: unknown }).File === 'undefined') {
  (globalThis as { File?: unknown }).File = class extends Blob {
    name: string;
    constructor(parts: BlobPart[], name: string, opts?: BlobPropertyBag) {
      super(parts, opts);
      this.name = name;
    }
  };
}
import { normalizePresentationContent } from '../src/utils/presentationContentSchema';
import { buildPresentationPptxFile } from '../src/utils/buildPresentationPptx';

const [input, output] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(input, 'utf-8'));
const deck = normalizePresentationContent(raw, { title: raw.presentation_title || 'Taqdimot', subject: raw.subject_area || '' });
// Rasm qayta tortilmaydi (havolasi bo'lsa ham) — faqat maket.
for (const s of deck.slides) delete (s as { imageSourceUrl?: string }).imageSourceUrl;
const file = await buildPresentationPptxFile(deck, { meta: { subjectName: deck.subject_area || 'Fan', topicId: 'T1' } });
writeFileSync(output, Buffer.from(await file.arrayBuffer()));
console.log('ok', output, deck.slides.length);
