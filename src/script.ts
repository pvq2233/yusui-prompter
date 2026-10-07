export const SAMPLE = `大家晚上好，欢迎来到社区咖啡的直播间。今天我们用一个新品介绍案例，一起体验语音跟读提词。

这是我们准备介绍的燕麦拿铁。它由浓缩咖啡和燕麦饮品搭配而成，有热饮和冰饮两种选择。现在，我把杯子拿近一些，大家可以看看它的颜色。

接下来介绍点单方式。到店后，可以先告诉店员你想要热饮还是冰饮，再根据自己的口味选择杯型。具体配料和价格，以店内当天公布的信息为准。

看到评论区有朋友问，第一次来该怎么选。你可以先说说平时喜欢什么口味，我们再一起看看菜单。这段交流可以自由发挥，提词只是帮助我们保持思路。

现在回顾一下今天的三个重点：先认识饮品，再了解点单方式，最后回答大家的问题。中控可以点击左侧章节，或者把想读的句子滚到横线处，点击三角按钮重新定位。

今天的案例演示到这里就结束了，谢谢大家的观看。你可以把这份示例替换成自己的讲稿。如果开启循环跟读，读完这一句后，提词器会等待五秒，再回到开场。`;

export type Paragraph = { id: string; text: string; title: string };
export type Cursor = { paragraph: number; offset: number };
// Arrays preserve explicit paragraph boundaries, including blank lines within a block.
export type ScriptContent = string | string[];
export function scriptToText(script: ScriptContent): string { return Array.isArray(script) ? script.join('\n\n') : script; }
export function parseScript(script: ScriptContent): Paragraph[] {
  const blocks = Array.isArray(script) ? script : script.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  return blocks.map(p => p.replace(/\r\n/g, '\n').trim()).filter(Boolean).map((text, i) => ({
    id: `p-${i}`, text, title: text.split(/[。！？\n]/)[0].slice(0, 26),
  }));
}
export function sentences(text: string) {
  const result: { text: string; start: number; end: number }[] = [];
  const pattern = /[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+/g;
  for (const match of text.matchAll(pattern)) result.push({ text: match[0], start: match.index!, end: match.index! + match[0].length });
  return result;
}
export function acceptsPosition(messageGeneration: number, currentGeneration: number, mode: string) {
  return messageGeneration === currentGeneration && (mode === 'following' || mode === 'relocating');
}
export function safeRead<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}
export function save(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private mode or full storage: the current session still works. */ } }
