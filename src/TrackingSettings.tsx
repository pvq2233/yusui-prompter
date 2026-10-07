import { DEFAULT_TRACKING, TRACKING_KEYS, TRACKING_OPTIONS, type TrackingSettings as Preferences } from './tracking';

export default function TrackingSettings({ value, onChange, transcriptMode }: { value: Preferences; onChange: (next: Preferences) => void; transcriptMode: boolean }) {
  return <div className="tracking-settings">
    <p className="tracking-intro">先跟随附近的文字，失配后在你允许的范围内重新定位。主播跳过一句，也能继续寻找后文。</p>
    {transcriptMode && <p className="tracking-mode-note">这些设置用于「智能跟读」。实时转写仍按最新文字滚动。</p>}
    {TRACKING_KEYS.map(key => {
      const option = TRACKING_OPTIONS[key];
      return <fieldset className="tracking-field" key={key} aria-describedby={`tracking-${key}-description`}>
        <legend>{option.title}</legend>
        <div className="tracking-choices">{option.choices.map(choice => <label className={`tracking-choice ${value[key] === choice.value ? 'selected' : ''}`} key={choice.value}>
          <input type="radio" name={key} value={choice.value} checked={value[key] === choice.value} onChange={() => onChange({ ...value, [key]: choice.value })}/>
          <span>{choice.label}</span><strong>{choice.detail}</strong>
        </label>)}</div>
        <p id={`tracking-${key}-description`}>{option.description}</p>
      </fieldset>;
    })}
    <div className="tracking-footer"><span>自动保存在本浏览器，下一次定位生效。<br/>调整不会打断录音，也不会解除暂停。</span><button className="quiet-button" onClick={() => onChange({ ...DEFAULT_TRACKING })}>恢复推荐</button></div>
  </div>;
}
