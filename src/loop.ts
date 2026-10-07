import type { Cursor, Paragraph } from './script';

/** The speech cursor excludes trailing punctuation, so compare the final spoken character. */
export function scriptFinished(paragraphs: Paragraph[], cursor: Cursor) {
  if (!paragraphs.length || cursor.paragraph !== paragraphs.length - 1) return false;
  const text = paragraphs.at(-1)!.text;
  const spoken = [...text.matchAll(/[\p{L}\p{N}]/gu)].at(-1);
  const end = spoken ? spoken.index! + spoken[0].length : text.length;
  return end > 0 && cursor.offset >= end;
}
