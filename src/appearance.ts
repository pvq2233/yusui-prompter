import type { CSSProperties } from 'react';

export const READING_FONTS = [
  { id: 'yahei', name: '微软雅黑', family: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  { id: 'dengxian', name: '等线', family: 'DengXian, "Microsoft YaHei", sans-serif' },
  { id: 'heiti', name: '黑体', family: 'SimHei, "Microsoft YaHei", sans-serif' },
  { id: 'songti', name: '宋体', family: 'SimSun, "Songti SC", serif' },
  { id: 'kaiti', name: '楷体', family: 'KaiTi, STKaiti, serif' },
  { id: 'fangsong', name: '仿宋', family: 'FangSong, STFangsong, serif' },
] as const;
export type Appearance = { font: typeof READING_FONTS[number]['id']; text: string; highlight: string; background: string };
export const APPEARANCE_PRESETS: { id: string; name: string; description: string; value: Appearance }[] = [
  { id: 'forest', name: '森林微光', description: '柔和绿意 · 微软雅黑', value: { font: 'yahei', text: '#adc29f', highlight: '#e0ecd3', background: '#17211b' } },
  { id: 'contrast', name: '清晰黑白', description: '纯黑底色 · 黑体', value: { font: 'heiti', text: '#c7cbd1', highlight: '#ffffff', background: '#090b0e' } },
  { id: 'paper', name: '暖纸书页', description: '浅色纸感 · 宋体', value: { font: 'songti', text: '#665c4e', highlight: '#251d14', background: '#f3ead9' } },
  { id: 'midnight', name: '午夜蓝调', description: '沉静深蓝 · 等线', value: { font: 'dengxian', text: '#9fb7cf', highlight: '#e1efff', background: '#101b2b' } },
  { id: 'amber', name: '琥珀暖光', description: '温暖金色 · 微软雅黑', value: { font: 'yahei', text: '#cbb78d', highlight: '#ffe4a6', background: '#211c16' } },
  { id: 'violet', name: '暮色柔紫', description: '低调紫灰 · 楷体', value: { font: 'kaiti', text: '#b8adc9', highlight: '#f2e5ff', background: '#201a29' } },
];
export const DEFAULT_APPEARANCE = APPEARANCE_PRESETS[0].value;

export function readAppearance(raw: unknown): Appearance {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const color = (key: 'text' | 'highlight' | 'background') => typeof value[key] === 'string' && /^#[\da-f]{6}$/i.test(value[key] as string) ? (value[key] as string).toLowerCase() : DEFAULT_APPEARANCE[key];
  return {
    font: READING_FONTS.find(font => font.id === value.font)?.id || DEFAULT_APPEARANCE.font,
    text: color('text'), highlight: color('highlight'), background: color('background'),
  };
}

function blend(foreground: string, background: string, amount: number) {
  return '#' + [1, 3, 5].map(index => Math.round(parseInt(foreground.slice(index, index + 2), 16) * amount + parseInt(background.slice(index, index + 2), 16) * (1 - amount)).toString(16).padStart(2, '0')).join('');
}

export function appearanceStyle(value: Appearance): CSSProperties {
  return {
    '--reading-font': READING_FONTS.find(font => font.id === value.font)!.family,
    '--reading-text': value.text,
    '--reading-highlight': value.highlight,
    '--reading-background': value.background,
    '--reading-muted': blend(value.text, value.background, .72),
    '--reading-past': blend(value.text, value.background, .62),
  } as CSSProperties;
}

export function interfaceStyle(value: Appearance): CSSProperties {
  const light = contrastRatio('#000000', value.background) > 7;
  const ink = blend(light ? '#000000' : '#ffffff', value.text, light ? .65 : .75);
  const accent = light ? blend('#000000', value.highlight, .15) : blend(value.highlight, value.text, .7);
  return {
    ...appearanceStyle(value),
    colorScheme: light ? 'light' : 'dark',
    '--ui-background': blend(light ? '#ffffff' : '#000000', value.background, light ? .25 : .22),
    '--ui-surface': value.background,
    '--ui-raised': blend('#ffffff', value.background, light ? .55 : .055),
    '--ui-input': blend(light ? '#ffffff' : '#000000', value.background, light ? .32 : .15),
    '--ui-selection': blend(accent, value.background, light ? .12 : .16),
    '--ui-border': blend(ink, value.background, .25),
    '--ui-muted': blend(ink, value.background, light ? .8 : .7),
    '--ui-text': ink,
    '--ui-strong': blend(light ? '#000000' : '#ffffff', ink, .18),
    '--ui-accent': accent,
    '--ui-on-accent': contrastRatio('#000000', accent) > 7 ? '#17251b' : '#ffffff',
    '--mint': accent, '--border': blend(ink, value.background, .25),
    '--muted': blend(ink, value.background, .7), '--surface': value.background,
  } as CSSProperties;
}

export function matchingPreset(value: Appearance) {
  return APPEARANCE_PRESETS.find(preset => (Object.keys(value) as (keyof Appearance)[]).every(key => preset.value[key] === value[key]));
}

export function contrastRatio(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
