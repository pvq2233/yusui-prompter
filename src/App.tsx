import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Check, ChevronDown, ChevronLeft, ChevronRight, Download, FileText, Focus, HelpCircle, Maximize, Mic, MonitorUp, Pause, Play, Search, Settings2, Square, Upload, X, FlipHorizontal2, Circle, PencilLine, LocateFixed } from 'lucide-react';
import { Capture, type Anchor, type ServerMessage } from './audio';
import { SAMPLE, acceptsPosition, parseScript, scriptToText, safeRead, save, type ScriptContent, type Cursor } from './script';
import PrompterText from './PrompterText';
import { usePresenterWindow } from './presenter-sync';
import TrackingSettings from './TrackingSettings';
import DesktopControls from './DesktopControls';
import ScriptEditor from './ScriptEditor';
import { sentenceAtGuide } from './guide-position';
import { readTracking, type TrackingSettings as TrackingPreferences } from './tracking';
import AppearanceSettings from './AppearanceSettings';
import { appearanceStyle, interfaceStyle, readAppearance } from './appearance';
import { scriptFinished } from './loop';

type Mode = 'following' | 'paused' | 'relocating';
type ModelStatus = { state: string; model?: string; device?: string; compute_type?: string; message?: string; warning?: string; busy?: boolean };
type Line = { text: string; time: string; id: number };
const labels: Record<Mode, string> = { following: '正在跟读', paused: '跟读已暂停', relocating: '等待语音定位' };

function followScrollTop(box: HTMLElement, transcriptMode: boolean) {
  if (transcriptMode) return box.scrollHeight;
  const active = box.querySelector<HTMLElement>('[data-active-line="true"]');
  return active ? Math.max(0, active.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight * .28) : box.scrollTop;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [script, setScript] = useState(() => safeRead<ScriptContent>('yusui-script', SAMPLE));
  const [title, setTitle] = useState(() => safeRead('yusui-title', '案例演示 · 社区咖啡新品介绍'));
  const [fontSize, setFontSize] = useState(() => Math.max(28, Math.min(72, safeRead('yusui-font', 42))));
  const [spacing, setSpacing] = useState(() => safeRead('yusui-spacing', 1.9));
  const [appearance, setAppearance] = useState(() => readAppearance(safeRead('yusui-appearance', null)));
  const [loopEnabled, setLoopEnabled] = useState(() => safeRead<boolean>('yusui-loop', false) === true);
  const [loopRemaining, setLoopRemaining] = useState<number | null>(null);
  const loopDeadline = useRef<number | null>(null);
  const [cursor, setCursor] = useState<Cursor>({ paragraph: 0, offset: 0 });
  const [mode, setMode] = useState<Mode>('relocating');
  // Browsing detaches only the console viewport; cursor and recognition keep advancing.
  const [browsing, setBrowsing] = useState(false);
  const [guideFeedback, setGuideFeedback] = useState(0);
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [demo, setDemo] = useState(false);
  const [model, setModel] = useState<ModelStatus>({ state: 'connecting', message: '正在连接本地服务' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState('');
  const [language, setLanguage] = useState('zh');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ScriptContent>('');
  const [draftTitle, setDraftTitle] = useState('');
  const [settings, setSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'tracking' | 'display' | 'appearance'>('tracking');
  const [tracking, setTracking] = useState(() => readTracking(safeRead('yusui-tracking', null)));
  const [help, setHelp] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [focus, setFocus] = useState(false);
  const [transcriptMode, setTranscriptMode] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  const [partial, setPartial] = useState('');
  const [inference, setInference] = useState(0);
  const [lag, setLag] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const paragraphs = parseScript(script);
  const capture = useRef<Capture | undefined>(undefined);
  const generation = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const guideLine = useRef<HTMLElement>(null);
  const nav = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const animation = useRef(0);
  const targetScroll = useRef(0);
  const current = useRef({ cursor, mode, paragraphs, language, transcriptMode, tracking, browsing, loopEnabled });
  current.current = { cursor, mode, paragraphs, language, transcriptMode, tracking, browsing, loopEnabled };
  const presenterState = useMemo(() => ({ script, title, cursor, mode, fontSize, spacing, appearance, loopRemaining, mirror, transcriptMode, transcript: lines.map(line => line.text).join(''), partial }), [script, title, cursor, mode, fontSize, spacing, appearance, loopRemaining, mirror, transcriptMode, lines, partial]);
  const presenter = usePresenterWindow(presenterState);

  const refreshDevices = useCallback(async () => {
    try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput')); } catch { /* Permission is requested only by Start. */ }
  }, []);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try { const response = await fetch('/api/status'); if (!response.ok) throw new Error(); const data = await response.json(); if (mounted) setModel(data); }
      catch { if (mounted) setModel({ state: 'offline', message: '本地服务未连接，请运行启动脚本' }); }
    };
    void refresh(); const poll = setInterval(refresh, 2500);
    void refreshDevices(); navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    return () => { mounted = false; clearInterval(poll); navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices); capture.current?.dispose(); };
  }, [refreshDevices]);
  useEffect(() => { save('yusui-script', script); save('yusui-title', title); }, [script, title]);
  useEffect(() => { save('yusui-font', fontSize); save('yusui-spacing', spacing); }, [fontSize, spacing]);
  useEffect(() => { save('yusui-appearance', appearance); }, [appearance]);
  useEffect(() => { save('yusui-loop', loopEnabled); }, [loopEnabled]);
  useEffect(() => { if (!live && !demo) return; const timer = setInterval(() => setSeconds(s => s + 1), 1000); return () => clearInterval(timer); }, [live, demo]);

  function anchor(position: Cursor, paused = false): Anchor {
    const state = current.current;
    return { generation: ++generation.current, paragraphs: state.transcriptMode ? [] : state.paragraphs.map(p => p.text), ...position, paused, language: state.language, tracking: state.tracking };
  }

  function applyTracking(next: TrackingPreferences) {
    const validated = readTracking(next);
    current.current.tracking = validated;
    setTracking(validated); save('yusui-tracking', validated);
    capture.current?.configureTracking(validated);
  }

  function cancelLoop() { loopDeadline.current = null; setLoopRemaining(null); }
  function beginLoop(position: Cursor) {
    const state = current.current;
    if (!state.loopEnabled || state.transcriptMode || state.mode === 'paused' || capture.current?.stopping || loopDeadline.current !== null || !scriptFinished(state.paragraphs, position)) return;
    loopDeadline.current = Date.now() + 5000; setLoopRemaining(5);
  }
  function changeLoop(enabled: boolean) {
    current.current.loopEnabled = enabled; setLoopEnabled(enabled);
    if (!enabled) cancelLoop();
  }

  function seek(paragraph: number, offset = 0, preserveBrowsing = false) {
    cancelLoop();
    const position = { paragraph: Math.max(0, Math.min(paragraph, current.current.paragraphs.length - 1)), offset };
    current.current.cursor = position; current.current.mode = 'relocating';
    if (!preserveBrowsing) { current.current.browsing = false; setBrowsing(false); }
    setCursor(position); setMode('relocating'); setConfidence(0); setPartial(''); setNotice('');
    capture.current?.reanchor(anchor(position));
    if (!capture.current) generation.current++;
  }

  function pause() {
    cancelLoop();
    current.current.mode = 'paused'; setMode('paused');
    capture.current?.reanchor(anchor(current.current.cursor, true));
    if (!capture.current) generation.current++;
    setPartial('');
  }

  function manual() {
    if (current.current.browsing) return;
    current.current.browsing = true; setBrowsing(true);
    cancelAnimationFrame(animation.current);
  }

  function returnToFollow() {
    current.current.browsing = false; setBrowsing(false);
    cancelAnimationFrame(animation.current);
    if (scroll.current) scroll.current.scrollTop = followScrollTop(scroll.current, current.current.transcriptMode);
  }

  function jumpToGuide() {
    if (current.current.transcriptMode || !scroll.current || !guideLine.current) return;
    cancelAnimationFrame(animation.current);
    const line = guideLine.current.getBoundingClientRect();
    const position = sentenceAtGuide(scroll.current, line.top + line.height / 2);
    if (!position) { setNotice('横线附近没有正文，请先滚动到要阅读的句子。'); return; }
    seek(position.paragraph, position.offset);
    setGuideFeedback(value => value + 1);
  }

  function receive(message: ServerMessage) {
    if (message.type === 'error') { cancelLoop(); setError(message.message || '识别发生错误'); return; }
    if (message.generation !== generation.current) return;
    if (message.type === 'transcript') {
      if (message.stable) setLines(previous => [...previous, { text: message.stable!, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), id: Date.now() + Math.random() }].slice(-1500));
      setPartial(message.partial || ''); setInference(message.inference_ms || 0); setLag(message.lag_ms || 0);
      if (current.current.transcriptMode && current.current.mode === 'relocating') { current.current.mode = 'following'; setMode('following'); }
    }
    if (message.type === 'position' && acceptsPosition(message.generation, generation.current, current.current.mode)) {
      const position = { paragraph: message.paragraph!, offset: message.offset! };
      current.current.cursor = position; current.current.mode = 'following';
      setCursor(position); setMode('following'); setConfidence(message.confidence || 0); setNotice('');
      beginLoop(position);
    }
    if (message.type === 'gap') { setNotice(message.message || '正在重新定位'); if (current.current.mode !== 'paused') { current.current.mode = 'relocating'; setMode('relocating'); } }
    if (message.type === 'uncertain' && current.current.mode === 'following') setNotice('暂未匹配讲稿，保持当前位置');
  }

  async function start() {
    cancelLoop();
    setError(''); setNotice(''); setStarting(true); setDemo(false); setSeconds(0);
    current.current.mode = 'relocating'; setMode('relocating');
    current.current.browsing = false; setBrowsing(false);
    const instance = new Capture(receive, setLevel, () => { cancelLoop(); setLive(false); setStarting(false); setStopping(false); capture.current = undefined; });
    capture.current = instance;
    try { await instance.start(device, anchor(current.current.cursor)); setLive(true); await refreshDevices(); }
    catch (err) { capture.current = undefined; setError(err instanceof Error ? (err.name === 'NotAllowedError' ? (window.yusuiDesktop ? '麦克风权限未开启。请在 Windows 设置的麦克风隐私权限中允许桌面应用访问，然后重试。' : '麦克风权限未开启。请在浏览器地址栏允许麦克风后重试。') : err.message) : '无法启动麦克风'); }
    finally { setStarting(false); }
  }

  async function stop() {
    cancelLoop();
    setStopping(true); await capture.current?.stop(); capture.current = undefined; setLive(false); setStopping(false); setPartial(''); setLevel(0);
  }

  useEffect(() => {
    const box = scroll.current;
    if (!box || browsing || mode === 'paused') return;
    if (transcriptMode) { box.scrollTop = box.scrollHeight; return; }
    targetScroll.current = followScrollTop(box, false);
    cancelAnimationFrame(animation.current);
    if (mode === 'relocating') { box.scrollTop = targetScroll.current; return; }
    let last = performance.now();
    const step = (now: number) => {
      if (current.current.browsing || current.current.mode === 'paused') return;
      const delta = Math.min(32, now - last); last = now;
      const difference = targetScroll.current - box.scrollTop;
      if (Math.abs(difference) < 2) return;
      box.scrollTop += Math.sign(difference) * Math.min(Math.abs(difference) * .14, delta * 1.1);
      animation.current = requestAnimationFrame(step);
    };
    animation.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animation.current);
  }, [cursor, mode, browsing, fontSize, spacing, appearance.font, transcriptMode, lines, partial, script, focus]);

  useEffect(() => { nav.current?.querySelector('.nav-item.active')?.scrollIntoView({ block: 'nearest' }); }, [cursor.paragraph]);
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [lines, partial]);

  useEffect(() => {
    if (!demo) return;
    const timer = setInterval(() => {
      const state = current.current;
      if (state.mode === 'paused' || loopDeadline.current !== null) return;
      const paragraph = state.paragraphs[state.cursor.paragraph];
      if (!paragraph) return;
      let next = { ...state.cursor, offset: state.cursor.offset + 5 };
      if (next.offset >= paragraph.text.length) {
        if (next.paragraph >= state.paragraphs.length - 1) {
          next.offset = paragraph.text.length;
          state.cursor = next; state.mode = 'following'; setCursor(next); setMode('following');
          beginLoop(next);
          if (!state.loopEnabled) setDemo(false);
          return;
        }
        next = { paragraph: next.paragraph + 1, offset: 0 };
      }
      state.cursor = next; state.mode = 'following'; setCursor(next); setMode('following');
    }, 650);
    return () => clearInterval(timer);
  }, [demo]);

  const countingDown = loopRemaining !== null;
  useEffect(() => {
    if (!countingDown) return;
    const timer = window.setInterval(() => {
      const deadline = loopDeadline.current;
      if (deadline === null) return;
      const state = current.current;
      if (!state.loopEnabled || state.mode === 'paused' || state.transcriptMode) { cancelLoop(); return; }
      const remaining = Math.ceil((deadline - Date.now()) / 1000);
      if (remaining <= 0) seek(0, 0, true);
      else setLoopRemaining(remaining);
    }, 100);
    return () => clearInterval(timer);
  }, [countingDown]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.closest('input,textarea,select,button,[contenteditable]') || editing || settings || help)) return;
      if (event.code === 'Space') { event.preventDefault(); if (current.current.mode === 'paused') seek(current.current.cursor.paragraph, current.current.cursor.offset); else pause(); }
      if (event.code === 'ArrowDown') { event.preventDefault(); seek(current.current.cursor.paragraph + 1); }
      if (event.code === 'ArrowUp') { event.preventDefault(); seek(current.current.cursor.paragraph - 1); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else { await document.documentElement.requestFullscreen(); setFocus(true); } }
    catch { setError('暂时无法进入全屏，可使用专注模式。'); }
  }
  function edit() { setDraft(script); setDraftTitle(title); setEditing(true); }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 800000) { setError('文件过大，请导入小于 800 KB 的 UTF-8 文本。'); return; }
    const text = await file.text(); setDraft(text); setDraftTitle(file.name.replace(/\.[^.]+$/, '')); setEditing(true);
    if (input.current) input.current.value = '';
  }
  function applyScript(content: ScriptContent, nextTitle: string) {
    current.current.paragraphs = parseScript(content);
    setScript(content); setTitle(nextTitle); setEditing(false); setDemo(false); seek(0);
  }
  function switchMode(value: boolean) {
    current.current.transcriptMode = value; setTranscriptMode(value); setDemo(false); seek(current.current.cursor.paragraph, current.current.cursor.offset);
  }

  const totalChars = paragraphs.reduce((sum, p) => sum + p.text.length, 0);
  const readChars = paragraphs.slice(0, cursor.paragraph).reduce((sum, p) => sum + p.text.length, 0) + cursor.offset;
  const progress = Math.min(100, Math.round(readChars / Math.max(1, totalChars) * 100));
  const isPaused = mode === 'paused';
  const followLabel = isPaused ? (browsing ? '浏览中 · 跟读已暂停' : '跟读已暂停') : browsing ? (demo ? '浏览中 · 演示继续（非语音识别）' : live ? '浏览中 · 语音跟读继续' : '正在浏览讲稿') : demo ? '演示中 · 非语音识别' : live ? labels[mode] : '准备就绪，按你的节奏开始';
  const time = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  return <div className={`app ${focus ? 'focus-mode' : ''}`} style={interfaceStyle(appearance)}>
    <header className="app-header">
      <a className="brand" href="#" onClick={event => event.preventDefault()}><span className="brand-symbol"><AudioLines size={23}/></span><strong>语随<span>LIVE PROMPTER</span></strong></a>
      <div className="header-center"><span className="small-dot"/> 本机运行 <i/> Whisper small</div>
      <div className="header-actions"><button className={`quiet-button presenter-launch ${presenter.connected ? 'connected' : ''}`} title={presenter.connected ? '主播窗口已连接，点击切回' : '复制提词正文到独立窗口，可拖到另一块屏幕'} onClick={() => { if (!presenter.open()) setError(window.yusuiDesktop ? '主播窗口未能打开，请重新点击「主播窗口」。' : '浏览器拦截了主播弹窗。请允许此站点弹出窗口，然后再次点击「主播窗口」。'); }}><MonitorUp size={17}/><span>主播窗口</span>{presenter.connected && <i/>}</button><button className="icon-button" title="使用帮助" aria-label="使用帮助" onClick={() => setHelp(true)}><HelpCircle size={19}/></button><button className="quiet-button" onClick={() => { setFocus(!focus); }}><Focus size={17}/>{focus ? '退出专注' : '专注模式'}</button></div>
      <DesktopControls/>
    </header>

    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-top"><div className="eyebrow">我的直播讲稿</div><h2>{title}</h2><div className="script-meta">{paragraphs.length} 个段落<span>·</span>{totalChars.toLocaleString()} 字<span>·</span>本地保存</div>
          <div className="script-actions"><button onClick={edit}><PencilLine size={15}/>编辑讲稿</button><button onClick={() => input.current?.click()} aria-label="导入讲稿" title="导入 TXT 或 Markdown"><Upload size={16}/></button><button onClick={() => download(`${title}.txt`, scriptToText(script))} aria-label="导出讲稿" title="导出讲稿"><Download size={16}/></button></div>
          <input ref={input} type="file" hidden accept=".txt,.md,text/plain,text/markdown" onChange={event => void importFile(event.target.files?.[0])}/>
        </div>
        <div className="nav-head"><span>段落导航</span><span>{String(cursor.paragraph + 1).padStart(2, '0')} / {String(paragraphs.length).padStart(2, '0')}</span></div>
        <label className="search"><Search size={16}/><input aria-label="搜索段落" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索讲稿内容…"/><kbd>⌕</kbd></label>
        <div className="paragraph-nav" ref={nav}>
          {paragraphs.map((paragraph, index) => (!search || paragraph.text.toLowerCase().includes(search.toLowerCase())) && <button key={paragraph.id} className={`nav-item ${cursor.paragraph === index ? 'active' : ''} ${index < cursor.paragraph ? 'read' : ''}`} onClick={() => { if (transcriptMode) switchMode(false); seek(index); }} aria-label={`跳转到第 ${index + 1} 段`}>
            <span className="nav-index">{index < cursor.paragraph ? <Check size={14}/> : String(index + 1).padStart(2, '0')}</span><span><strong>{paragraph.title}</strong><small>{paragraph.text.slice(26, 64) || `${paragraph.text.length} 字`}</small></span>{cursor.paragraph === index && <span className="active-dot"/>}
          </button>)}
          {search && !paragraphs.some(p => p.text.toLowerCase().includes(search.toLowerCase())) && <div className="no-results">没有找到相关段落</div>}
        </div>
        <div className="sidebar-bottom"><div className="demo-card"><span className="demo-icon"><AudioLines size={19}/></span><div><strong>先感受一下跟读节奏</strong><small>不用麦克风，也能体验提词</small></div><button aria-label={demo ? '停止演示' : '体验跟读'} disabled={live || starting || transcriptMode} onClick={() => { if (demo) cancelLoop(); setDemo(!demo); if (!demo) { setError(''); setSeconds(0); seek(cursor.paragraph, cursor.offset); } }}>{demo ? <Square size={15}/> : <Play size={15}/>}</button></div><p><kbd>↑</kbd><kbd>↓</kbd> 切换段落 <span>·</span><kbd>空格</kbd> 暂停跟读</p></div>
      </aside>

      <main className="main">
        <div className="main-toolbar"><div className="view-tabs"><button className={!transcriptMode ? 'selected' : ''} onClick={() => switchMode(false)}><FileText size={16}/>智能跟读</button><button className={transcriptMode ? 'selected' : ''} onClick={() => switchMode(true)}><AudioLines size={16}/>实时转写</button></div><div className="view-controls"><button className={mirror ? 'toggled' : ''} title="镜像文字" aria-label="镜像文字" onClick={() => setMirror(!mirror)}><FlipHorizontal2 size={18}/></button><span/><button title="字号减小" aria-label="字号减小" disabled={fontSize <= 28} onClick={() => setFontSize(s => Math.max(28, s - 2))}>A−</button><label className="font-number">{fontSize}</label><button title="字号增大" aria-label="字号增大" disabled={fontSize >= 72} onClick={() => setFontSize(s => Math.min(72, s + 2))}>A+</button><span/><button aria-label="提词设置" title="提词设置：跟踪策略、显示与语言" onClick={() => setSettings(true)}><Settings2 size={18}/></button><button aria-label="全屏" title="全屏" onClick={() => void fullscreen()}><Maximize size={18}/></button></div></div>

        {(error || notice || model.warning) && <div className={`message-bar ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><span>{error || notice || model.warning}</span><button aria-label="关闭提示" onClick={() => { setError(''); setNotice(''); if (model.warning) setModel({ ...model, warning: '' }); }}><X size={15}/></button></div>}

        <section className="prompter-shell reading-appearance" aria-label="提词画面" style={appearanceStyle(appearance)}>
          <div className="stage-info"><span className={`follow-badge ${isPaused ? 'paused' : ''}`}><span/>{followLabel}</span><span className="elapsed"><Circle size={7} fill="currentColor"/>{time}</span></div>
          {loopRemaining !== null && <div className="loop-countdown" role="status" aria-live="polite"><strong>{loopRemaining}</strong><span>秒后回到第一句</span></div>}
          <div className={`reading-guide ${transcriptMode ? '' : 'interactive-guide'}`}>
            {transcriptMode ? <span/> : <button className="guide-jump" aria-label="跳转到横线处的句子" title="点击跳转到横线处的句子；同一行有多句时定位到第一句" onClick={jumpToGuide}>
              <Play size={14} fill="currentColor" strokeWidth={0}/>
              {guideFeedback > 0 && <b key={guideFeedback} className="guide-click-feedback" onAnimationEnd={() => setGuideFeedback(0)}/>}
            </button>}
            <i ref={guideLine}/>
          </div>
          <div className="prompter-scroll" ref={scroll} onWheel={manual} onTouchMove={manual} onPointerDown={event => { if (event.target === scroll.current) manual(); }} style={{ fontSize, lineHeight: spacing }}>
            <div className={`prompter-content ${mirror ? 'mirrored' : ''}`}>
              {transcriptMode ? <div className="live-text">{lines.length === 0 && !partial ? <div className="empty-transcript"><AudioLines size={40}/><h2>让声音成为文字</h2><p>点击「开始识别」，你的话会出现在这里。</p><small>浏览历史时暂停滚动，点击「回到最新」继续尾随。</small></div> : <><span>{lines.map(line => line.text).join('')}</span><span className="partial-text">{partial}</span><span className="cursor-blink"/></>}</div> : <PrompterText paragraphs={paragraphs} cursor={cursor}/>}
              {!transcriptMode && <div className="script-end"><span/> 讲稿结束，感谢每一次真诚的表达 <span/></div>}
            </div>
          </div>
          <div className="stage-bottom"><span>{transcriptMode ? `${lines.reduce((sum, line) => sum + line.text.length, 0)} 字已转写` : `第 ${cursor.paragraph + 1} 段 / 共 ${paragraphs.length} 段`}</span><div className="stage-shortcuts">{browsing && <button className="resume-chip" onClick={returnToFollow}><LocateFixed size={12}/>{transcriptMode ? '回到最新' : '回到跟读位置'}</button>}<span>{confidence > 0 && live && !transcriptMode ? `匹配 ${Math.round(confidence * 100)}%` : '手动定位始终可用'}</span></div></div>
          {!transcriptMode && <div className="progress-track"><span style={{ width: `${progress}%` }}/></div>}
        </section>

        <section className={`transcript-panel ${showTranscript ? '' : 'collapsed'}`}>
          <div className="transcript-heading"><button onClick={() => setShowTranscript(!showTranscript)}><AudioLines size={16}/><strong>实时转写</strong><span>识别内容会在这里同步显示</span><ChevronDown size={14} className={showTranscript ? '' : 'rotate'}/></button><div><span className="stable-key"><i/>已确认</span><span className="partial-key"><i/>识别中</span><button className="icon-button" title="导出转写" aria-label="导出转写" disabled={!lines.length} onClick={() => download(`转写-${new Date().toISOString().slice(0, 10)}.txt`, lines.map(line => line.text).join(''))}><Download size={15}/></button></div></div>
          {showTranscript && <div className="transcript-feed" ref={transcript}>{lines.length || partial ? <><span className="transcript-time">{lines.at(-1)?.time}</span><span>{lines.slice(-16).map(line => line.text).join('')}</span><span className="partial-text">{partial}</span></> : <span className="transcript-placeholder">{demo ? '当前为界面演示，未调用模型，也未录制声音。' : '等待你的声音。识别中间结果以灰色显示，确认后用于跟读定位。'}</span>}</div>}
        </section>

        <footer className="control-bar"><div className="mic-control"><div className={`mic-icon ${live ? 'on' : ''}`}><Mic size={19}/></div><div><label><select aria-label="麦克风" value={device} disabled={live || starting} onChange={event => setDevice(event.target.value)}><option value="">系统默认麦克风</option>{devices.filter(d => d.deviceId !== 'default').map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `麦克风 ${i + 1}`}</option>)}</select></label><div className="meter">{Array.from({ length: 22 }, (_, i) => <i key={i} className={live && i < Math.min(22, Math.sqrt(level) * 70) ? 'lit' : ''}/>)}<span>{live ? '正在收音' : '麦克风未开启'}</span></div></div></div><div className="transport"><button className="skip" aria-label="上一段" disabled={cursor.paragraph === 0 || transcriptMode} onClick={() => seek(cursor.paragraph - 1)}><ChevronLeft size={21}/></button><button className="pause-button" aria-label={isPaused ? '恢复跟读' : '暂停跟读'} title="空格：暂停 / 恢复" onClick={() => isPaused ? seek(cursor.paragraph, cursor.offset) : pause()}>{isPaused ? <Play size={19}/> : <Pause size={19}/>}</button><button className={`start-button ${live ? 'recording' : ''}`} disabled={starting || stopping || (!live && model.state !== 'ready')} onClick={() => void (live ? stop() : start())}>{live ? <Square size={14} fill="currentColor"/> : <Mic size={18}/>} {starting ? '正在开启…' : stopping ? '正在收尾…' : live ? '停止识别' : '开始识别'}</button><button className="skip" aria-label="下一段" disabled={cursor.paragraph >= paragraphs.length - 1 || transcriptMode} onClick={() => seek(cursor.paragraph + 1)}><ChevronRight size={21}/></button></div><div className="engine-status"><div><span className={`engine-dot ${model.state}`}/><strong>Whisper small</strong><span className="device-badge">{model.device?.toUpperCase() || 'LOCAL'}</span></div><small>{model.state === 'ready' ? (inference ? `推理 ${(inference / 1000).toFixed(1)}s${lag > 500 ? ` · 积压 ${(lag / 1000).toFixed(1)}s` : ''}` : `${model.compute_type || ''} · 模型已就绪`) : model.state === 'loading' ? '正在下载 / 加载模型…' : model.state === 'error' ? '模型加载失败' : '等待本地服务'}{model.state === 'error' && <button onClick={() => void fetch('/api/model/retry', { method: 'POST' })}>重试</button>}</small></div></footer>
        {(model.state === 'error' || model.state === 'offline') && <div className="model-detail">{model.message}</div>}
      </main>
    </div>

    {editing && <ScriptEditor script={draft} title={draftTitle} onClose={() => setEditing(false)} onSave={applyScript}/>}
    {settings && <div className="modal-backdrop" onClick={() => setSettings(false)}><section className={`modal settings ${settingsTab === 'appearance' ? 'appearance-modal' : ''}`} role="dialog" aria-modal="true" aria-label="提词设置" onClick={event => event.stopPropagation()}>
      <div className="modal-head"><div><h2>让提词适合你</h2><p>调整阅读体验与语音跟踪方式。</p></div><button className="icon-button" aria-label="关闭设置" onClick={() => setSettings(false)}><X size={20}/></button></div>
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        <button id="tracking-tab" role="tab" aria-selected={settingsTab === 'tracking'} aria-controls="tracking-panel" onClick={() => setSettingsTab('tracking')}>跟踪策略</button>
        <button id="display-tab" role="tab" aria-selected={settingsTab === 'display'} aria-controls="display-panel" onClick={() => setSettingsTab('display')}>显示与语言</button>
        <button id="appearance-tab" role="tab" aria-selected={settingsTab === 'appearance'} aria-controls="appearance-panel" onClick={() => setSettingsTab('appearance')}>字体与颜色</button>
      </div>
      {settingsTab === 'tracking' ? <div role="tabpanel" id="tracking-panel" aria-labelledby="tracking-tab"><TrackingSettings value={tracking} onChange={applyTracking} transcriptMode={transcriptMode}/></div> : settingsTab === 'appearance' ? <div role="tabpanel" id="appearance-panel" aria-labelledby="appearance-tab"><AppearanceSettings value={appearance} onChange={setAppearance}/></div> :
        <div role="tabpanel" id="display-panel" aria-labelledby="display-tab">
          <label className="setting-row">文字大小 <strong>{fontSize} px</strong><input aria-label="文字大小" type="range" min="28" max="72" step="2" value={fontSize} onChange={event => setFontSize(Number(event.target.value))}/></label>
          <label className="setting-row">行间距 <strong>{spacing.toFixed(1)} 倍</strong><input aria-label="行间距" type="range" min="1.4" max="2.5" step="0.1" value={spacing} onChange={event => setSpacing(Number(event.target.value))}/></label>
          <label className="setting-row inline">识别语言<select aria-label="识别语言" value={language} disabled={live || starting} onChange={event => setLanguage(event.target.value)}><option value="zh">中文</option><option value="en">英语</option><option value="">自动检测</option></select></label>
          <label className="loop-setting"><span><strong>循环跟读</strong><small>{transcriptMode ? '仅用于智能跟读，切回讲稿后可调整。' : '读完最后一句后，倒计时 5 秒回到第一句。'}</small></span><input type="checkbox" role="switch" aria-label="循环跟读" checked={loopEnabled} disabled={transcriptMode} onChange={event => changeLoop(event.target.checked)}/></label>
          <p className="setting-note">音频仅在本机处理。首次使用需下载 small 模型，模型就绪后可离线识别。识别语言需在开始前选择。</p>
          <button className="quiet-button" disabled={live || starting} onClick={() => { setLines([]); setPartial(''); }}>清空转写记录</button>
        </div>}
    </section></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="modal help" role="dialog" aria-modal="true" aria-label="使用帮助" onClick={event => event.stopPropagation()}><div className="modal-head"><h2>按你的节奏，开始表达</h2><button className="icon-button" aria-label="关闭帮助" onClick={() => setHelp(false)}><X size={20}/></button></div><ol><li><strong>准备讲稿</strong><p>编辑或导入 TXT / Markdown，空行分隔段落。</p></li><li><strong>开启识别</strong><p>等待 Whisper small 就绪，选择麦克风并点击「开始识别」。</p></li><li><strong>自然地读下去</strong><p>稳定识别结果匹配讲稿后自动跟读；停顿或临场发挥时保持原位。</p></li><li><strong>随时调整</strong><p>点击左侧目录或按 ↑ / ↓ 跳段；空格暂停。滚轮浏览时跟读继续，点击「回到跟读位置」返回当前进度。实时转写模式可无稿使用。</p></li></ol><div className="help-note">演示按钮只模拟滚动。真实识别延迟取决于硬件与直播负载，界面显示实际推理耗时。讲稿存储在{window.yusuiDesktop ? '当前客户端' : '当前浏览器'}；音频不落盘，转写记录保留在当前会话（最多 1500 条），重要内容请及时导出。</div></section></div>}
  </div>;
}
