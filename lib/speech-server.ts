import { LOCALE } from "./tts";

const CHUNK_SIZE = 350;
const sentenceEnd = /[.!?।॥]+["'”’»)]*(?=\s|$)/gu;

export function splitText(text: string): string[] {
  const chunks: string[] = [];
  while (text.length > CHUNK_SIZE) {
    const prefix = text.slice(0, CHUNK_SIZE);
    let boundary = 0;
    for (const match of text.matchAll(sentenceEnd)) {
      const end = match.index + match[0].length;
      if (end > CHUNK_SIZE) break;
      boundary = end;
    }
    if (!boundary) {
      boundary = Math.max(prefix.lastIndexOf(" "), prefix.lastIndexOf("\n"), prefix.lastIndexOf("\t"));
    }
    if (boundary <= 0) {
      for (const grapheme of new Intl.Segmenter(LOCALE).segment(prefix)) {
        if (grapheme.index > 0) boundary = grapheme.index;
      }
      // A single exceptionally large cluster still needs a safe code point split.
      if (!boundary) boundary = /[\uD800-\uDBFF]$/u.test(prefix) ? CHUNK_SIZE - 1 : CHUNK_SIZE;
    }
    chunks.push(text.slice(0, boundary).trim());
    text = text.slice(boundary).trimStart();
  }
  if (text.trim()) chunks.push(text.trim());
  return chunks;
}
