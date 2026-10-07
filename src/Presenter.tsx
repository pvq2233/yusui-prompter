import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import PrompterText from './PrompterText';
import DesktopControls from './DesktopControls';
import { parseScript } from './script';
import { PROTOCOL, type PresenterFrame } from './presenter-sync';
import { interfaceStyle, readAppearance } from './appearance';

/** Read-only output: deliberately mounts no capture, model polling or controller. */
export default function Presenter() {
  const [frame, setFrame] = useState<PresenterFrame | null>(null);
  const [connected, setConnected] = useState(false);
  const [controls, setControls] = useState(true);
  const [full, setFull] = useState(false);
  const [error, setError] = useState('');
  const [size, setSize] = useState(0);
  const token = useRef(new URLSearchParams(location.search).get('session'));
  const version = useRef({ epoch: '', revision: -1 });
  const lastSeen = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const animation = useRef(0);
  const hideTimer = useRef(0);
  const hasState = useRef(false);
  const previousFrame = useRef<PresenterFrame | null>(null);

  useEffect(() => {
    const parent = window.opener as Window | null;
    const request = () => {
      if (parent && !parent.closed) parent.postMessage({ protocol: PROTOCOL, type: hasState.current ? 'ping' : 'ready', token: token.current, ...version.current }, location.origin);
      if (!parent || parent.closed || (lastSeen.current && Date.now() - lastSeen.current > 8000)) setConnected(false);
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.origin !== location.origin || event.source !== parent || data?.protocol !== PROTOCOL || data.token !== token.current) return;
      if (data.type === 'disconnected') { setConnected(false); return; }
      if (data.type !== 'state' && data.type !== 'heartbeat') return;
      lastSeen.current = Date.now(); setConnected(true);
      if (data.type === 'state' && data.state && (data.epoch !== version.current.epoch || data.revision > version.current.revision)) {
        version.current = { epoch: data.epoch, revision: data.revision };
        hasState.current = true; setFrame(data.state);
        document.title = `${data.state.title} · 主播窗口`;
      }
    };
    const leaving = () => { if (parent && !parent.closed) parent.postMessage({ protocol: PROTOCOL, type: 'closed', token: token.current }, location.origin); };
    window.addEventListener('message', receive); window.addEventListener('pagehide', leaving);
    request(); const timer = window.setInterval(request, 1000);
    return () => { clearInterval(timer); window.removeEventListener('message', receive); window.removeEventListener('pagehide', leaving); };
  }, []);

  useEffect(() => {
    const resize = new ResizeObserver(() => setSize(n => n + 1));
    if (scroll.current) resize.observe(scroll.current);
    const fullscreenChanged = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    hideTimer.current = window.setTimeout(() => setControls(false), 2200);
    return () => { resize.disconnect(); clearTimeout(hideTimer.current); document.removeEventListener('fullscreenchange', fullscreenChanged); };
  }, []);

  useLayoutEffect(() => {
    const box = scroll.current;
    if (!box || !frame) return;
    cancelAnimationFrame(animation.current);
    const previous = previousFrame.current;
    previousFrame.current = frame;
    // Explicit pause freezes this window, including incoming transcript text.
    if (frame.mode === 'paused' && frame.transcriptMode && previous?.transcriptMode) return;
    let target = 0;
    if (frame.transcriptMode) target = box.scrollHeight - box.clientHeight;
    else {
      const active = box.querySelector<HTMLElement>('[data-active-line="true"]');
      if (!active) return;
      const rect = active.getBoundingClientRect();
      target = Math.max(0, rect.top - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight * .28);
    }
    if (frame.mode !== 'following' || frame.transcriptMode || matchMedia('(prefers-reduced-motion: reduce)').matches) { box.scrollTop = target; return; }
    let last = performance.now();
    const step = (now: number) => {
      const difference = target - box.scrollTop;
      if (Math.abs(difference) < 2) return;
      const delta = Math.min(32, now - last); last = now;
      box.scrollTop += Math.sign(difference) * Math.min(Math.abs(difference) * .14, delta * 1.5);
      animation.current = requestAnimationFrame(step);
    };
    animation.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animation.current);
  }, [frame, size]);

  function showControls() { setControls(true); clearTimeout(hideTimer.current); hideTimer.current = window.setTimeout(() => setControls(false), 1800); }
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { setError(window.yusuiDesktop ? '暂时无法进入全屏，可点击右上角最大化窗口。' : '请按 F11 进入浏览器全屏。'); }
  }

  return <main className={`presenter-screen reading-appearance ${controls ? 'show-controls' : ''}`} style={interfaceStyle(readAppearance(frame?.appearance))} aria-label="主播提词窗口" onPointerMove={showControls} onDoubleClick={() => void fullscreen()}>
    {window.yusuiDesktop && !full && <div className="presenter-drag-region"><span>拖动到主播屏幕</span></div>}
    <div className="presenter-tools"><button aria-label={full ? '退出主播全屏' : '主播窗口全屏'} title="全屏，也可双击正文" onClick={() => void fullscreen()}>{full ? <Minimize size={19}/> : <Maximize size={19}/>}</button><DesktopControls presenter/></div>
    {(!connected || error) && <div className="presenter-connection" role="status">{error || (frame ? '中控连接已断开，保留最后画面。请保持中控窗口开启。' : '正在等待中控画面，请从中控点击「主播窗口」打开。')}</div>}
    {connected && frame?.loopRemaining != null && <div className="loop-countdown" role="status"><strong>{frame.loopRemaining}</strong><span>秒后回到第一句</span></div>}
    <div className="presenter-scroll" ref={scroll} style={{ fontSize: frame?.fontSize || 42, lineHeight: frame?.spacing || 1.9 }}>
      <div className={`presenter-content ${frame?.mirror ? 'mirrored' : ''}`}>
        {frame && (frame.transcriptMode ? <div className="live-text">{frame.transcript || frame.partial ? <><span>{frame.transcript}</span><span className="partial-text">{frame.partial}</span></> : <p className="presenter-waiting">等待语音…</p>}</div> : <PrompterText paragraphs={parseScript(frame.script)} cursor={frame.cursor} labels={false}/>)}
      </div>
    </div>
  </main>;
}
