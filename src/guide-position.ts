import type { Cursor } from './script';

/** Use individual wrapped lines, not the bounding box of a multi-line sentence. */
export function sentenceAtGuide(box: HTMLElement, y: number): Cursor | null {
  const viewport = box.getBoundingClientRect();
  let best: { position: Cursor; distance: number } | undefined;
  for (const span of box.querySelectorAll<HTMLElement>('[data-sentence-start]')) {
    if (!span.textContent?.trim()) continue;
    for (const rect of span.getClientRects()) {
      if (!rect.width || !rect.height || rect.bottom < viewport.top || rect.top > viewport.bottom) continue;
      const distance = Math.max(rect.top - y, y - rect.bottom, 0);
      // On a shared visual line, the first sentence in reading order wins.
      if (!best || distance < best.distance) {
        const paragraph = Number(span.closest('[data-paragraph]')?.getAttribute('data-paragraph'));
        const offset = Number(span.dataset.sentenceStart);
        if (Number.isInteger(paragraph) && Number.isInteger(offset)) best = { position: { paragraph, offset }, distance };
      }
    }
  }
  return best?.position ?? null;
}
