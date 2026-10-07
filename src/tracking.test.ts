import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACKING, readTracking } from './tracking';

describe('saved tracking preferences', () => {
  it('recovers corrupt or obsolete fields without losing valid choices', () => {
    expect(readTracking(null)).toEqual(DEFAULT_TRACKING);
    expect(readTracking({ similarity: .65, max_jump_chars: 999999, recovery_misses: false, lookahead_paragraphs: 6 })).toEqual({ ...DEFAULT_TRACKING, similarity: .65, lookahead_paragraphs: 6 });
    expect(readTracking({ similarity: '0.65', max_jump_chars: null })).toEqual(DEFAULT_TRACKING);
  });
});
