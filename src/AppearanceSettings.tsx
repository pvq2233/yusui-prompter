import { Check, RotateCcw } from 'lucide-react';
import { APPEARANCE_PRESETS, DEFAULT_APPEARANCE, READING_FONTS, appearanceStyle, contrastRatio, matchingPreset, type Appearance } from './appearance';

export default function AppearanceSettings({ value, onChange }: { value: Appearance; onChange: (value: Appearance) => void }) {
  const selected = matchingPreset(value);
  const lowContrast = Math.min(contrastRatio(value.text, value.background), contrastRatio(value.highlight, value.background)) < 3;
  return <div className="appearance-settings">
    <div className="appearance-layout"><div>
    <div className="appearance-heading"><span>阅读预设</span><small>{selected?.name || '自定义配色'}</small></div>
    <div className="appearance-presets" role="group" aria-label="阅读预设">
      {APPEARANCE_PRESETS.map(preset => <button key={preset.id} className="appearance-preset" aria-label={preset.name} aria-pressed={selected?.id === preset.id} onClick={() => onChange({ ...preset.value })}>
        <span className="preset-sample" style={appearanceStyle(preset.value)}><span>让表达</span><strong>自然发生</strong></span>
        <span className="preset-caption"><strong>{preset.name}</strong>{selected?.id === preset.id && <Check size={14}/>}<small>{preset.description}</small></span>
      </button>)}
    </div>
    </div><div className="appearance-custom">
    <label className="setting-row inline">提词字体<select aria-label="提词字体" value={value.font} onChange={event => onChange({ ...value, font: event.target.value as Appearance['font'] })}>{READING_FONTS.map(font => <option key={font.id} value={font.id}>{font.name}</option>)}</select></label>
    <div className="appearance-colors">
      {([{ key: 'text', label: '正文颜色' }, { key: 'highlight', label: '当前句高亮' }, { key: 'background', label: '画面背景' }] as const).map(color => <label key={color.key}><span>{color.label}</span><span className="color-control"><input type="color" aria-label={color.label} value={value[color.key]} onChange={event => onChange({ ...value, [color.key]: event.target.value })}/><code>{value[color.key].toUpperCase()}</code></span></label>)}
    </div>
    <div className="appearance-preview" style={appearanceStyle(value)} aria-label="提词样式预览"><small>阅读效果</small><p>大家好，欢迎来到直播间。<br/><strong>按自己的节奏，把话说清楚。</strong></p></div>
    {lowContrast && <p className="appearance-contrast" role="status">文字与背景比较接近，建议调整颜色，让主播更容易看清。</p>}
    </div></div>
    <div className="appearance-footer"><p>即选即用，自动保存并同步到主播窗口。字体使用本机安装的字体，缺失时使用系统替代字体。</p><button className="quiet-button" onClick={() => onChange({ ...DEFAULT_APPEARANCE })}><RotateCcw size={14}/>恢复默认</button></div>
  </div>;
}
