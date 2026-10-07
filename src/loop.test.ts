import { describe, expect, it } from 'vitest';
import { parseScript } from './script';
import { scriptFinished } from './loop';

describe('spoken end of a script', () => {
  it('waits for the final spoken character rather than entry to the final sentence', () => {
    const paragraphs = parseScript('开场欢迎大家。\n\n结束，谢谢大家！');
    expect(scriptFinished(paragraphs,{paragraph:0,offset:100})).toBe(false);
    expect(scriptFinished(paragraphs,{paragraph:1,offset:3})).toBe(false);
    expect(scriptFinished(paragraphs,{paragraph:1,offset:6})).toBe(false);
    expect(scriptFinished(paragraphs,{paragraph:1,offset:7})).toBe(true);
  });
  it('handles trailing punctuation, English and an empty script', () => {
    expect(scriptFinished(parseScript('Thanks for watching...\n'),{paragraph:0,offset:19})).toBe(true);
    expect(scriptFinished(parseScript('谢谢大家！！'),{paragraph:0,offset:4})).toBe(true);
    expect(scriptFinished([],{paragraph:0,offset:0})).toBe(false);
  });
});
