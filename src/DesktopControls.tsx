import { useEffect, useState } from 'react';
import { Minus, Square, Copy, X, Pin } from 'lucide-react';

type WindowState = { maximized: boolean; fullscreen: boolean; alwaysOnTop: boolean };
declare global {
  interface Window {
    yusuiDesktop?: {
      window: (action: 'minimize' | 'maximize' | 'close' | 'state' | 'toggle-always-on-top') => Promise<WindowState | undefined>;
      onState: (callback: (state: WindowState) => void) => () => void;
    };
  }
}

export default function DesktopControls({ presenter = false }: { presenter?: boolean }) {
  const desktop = window.yusuiDesktop;
  const [maximized, setMaximized] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pinPending, setPinPending] = useState(false);
  const [pinError, setPinError] = useState('');
  useEffect(() => {
    if (!desktop) return;
    const update = (state: WindowState) => { setMaximized(state.maximized); setPinned(state.alwaysOnTop); };
    void desktop.window('state').then(state => { if (state) update(state); });
    return desktop.onState(update);
  }, [desktop]);
  if (!desktop) return null;
  async function togglePin() {
    if (!desktop || pinPending) return;
    setPinPending(true); setPinError('');
    try { const state = await desktop.window('toggle-always-on-top'); if (state) setPinned(state.alwaysOnTop); }
    catch { setPinError('无法切换置顶，请重启客户端后重试。'); }
    finally { setPinPending(false); }
  }
  return <div className="desktop-window-controls">
    {presenter && <button className="presenter-pin" aria-label={pinned ? '取消主播窗口置顶' : '主播窗口置顶'} aria-pressed={pinned} title={pinError || (pinned ? '已置顶，点击取消' : '置顶，保持在其他窗口之上')} disabled={pinPending} onClick={() => void togglePin()}><Pin size={16} fill={pinned ? 'currentColor' : 'none'}/></button>}
    {pinError && <span className="presenter-pin-error" role="alert">{pinError}</span>}
    <button aria-label="最小化窗口" title="最小化" onClick={() => void desktop.window('minimize')}><Minus size={16}/></button>
    <button aria-label={maximized ? '还原窗口' : '最大化窗口'} title={maximized ? '还原' : '最大化'} onClick={() => void desktop.window('maximize')}>{maximized ? <Copy size={13}/> : <Square size={13}/>}</button>
    <button className="desktop-close" aria-label="关闭窗口" title="关闭" onClick={() => void desktop.window('close')}><X size={17}/></button>
  </div>;
}
