import { describe, it, expect } from 'vitest';
import { parseScript, sentences, acceptsPosition } from './script';
describe('script and cursor behavior', () => {
  it('splits blank lines but keeps a paragraph line break', () => {
    expect(parseScript('第一行\n第二行\r\n\r\n最后一段').map(p => p.text)).toEqual(['第一行\n第二行', '最后一段']);
  });
  it('keeps manual block boundaries even with pasted blank lines and empty blocks', () => {
    const parsed = parseScript([' 第一框\r\n\r\n仍是第一段。 ', '  ', '第二框。']);
    expect(parsed.map(p => p.text)).toEqual(['第一框\n\n仍是第一段。', '第二框。']);
    expect(parsed.map(p => p.id)).toEqual(['p-0', 'p-1']);
  });
  it('preserves source positions and punctuation when finding sentences', () => {
    const text = '大家好！欢迎\n来到直播间。'; const chunks = sentences(text);
    expect(chunks.map(c => c.text).join('')).toBe(text);
    expect(chunks.every(c => text.slice(c.start, c.end) === c.text)).toBe(true);
  });
  it('accepts active tracking and rejects old generations or explicit pause', () => {
    expect(acceptsPosition(2, 3, 'relocating')).toBe(false);
    expect(acceptsPosition(3, 3, 'following')).toBe(true);
    expect(acceptsPosition(3, 3, 'paused')).toBe(false);
    expect(acceptsPosition(3, 3, 'relocating')).toBe(true);
  });
});
