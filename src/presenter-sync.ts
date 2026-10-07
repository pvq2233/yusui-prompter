import { useEffect, useRef, useState } from 'react';
import type { Cursor, ScriptContent } from './script';
import type { Appearance } from './appearance';

export type PresenterState = {
  script: ScriptContent; title: string; cursor: Cursor; mode: string;
  fontSize: number; spacing: number; mirror: boolean; transcriptMode: boolean;
  appearance: Appearance;
  loopRemaining: number | null;
  transcript: string; partial: string;
};
export type PresenterFrame = PresenterState;
const PROTOCOL = 'yusui-presenter-v1';
export { PROTOCOL };

function controllerToken() {
  // A reload keeps the connection. Messages remain bound to the actual opener,
  // even if another tab was duplicated with the same sessionStorage contents.
  try {
    const saved = sessionStorage.getItem('yusui-presenter-token');
    if (saved) return saved;
    const token = crypto.randomUUID(); sessionStorage.setItem('yusui-presenter-token', token); return token;
  } catch { return crypto.randomUUID(); }
}

export function usePresenterWindow(snapshot: PresenterState) {
  const [token] = useState(controllerToken);
  const [epoch] = useState(() => crypto.randomUUID());
  const [connected, setConnected] = useState(false);
  const popup = useRef<Window | null>(null);
  const latest = useRef(snapshot); latest.current = snapshot;
  const revision = useRef(0);
  const lastSeen = useRef(0);
  const send = useRef<() => void>(() => {});

  useEffect(() => {
    const post = (type: string, extra = {}) => {
      if (popup.current && !popup.current.closed) popup.current.postMessage({ protocol: PROTOCOL, token, epoch, revision: revision.current, type, ...extra }, location.origin);
    };
    // The presenter follows the speech cursor, independent of console browsing.
    const publish = () => post('state', { state: latest.current satisfies PresenterFrame });
    send.current = publish;
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (event.origin !== location.origin || data?.protocol !== PROTOCOL || data.token !== token) return;
      const source = event.source as Window | null;
      try { if (!source || source.opener !== window) return; } catch { return; }
      if (data.type === 'ready' || data.type === 'ping') {
        // Multiple presenter views cannot acquire the microphone or mutate state.
        if (popup.current && !popup.current.closed && popup.current !== source) return;
        popup.current = source; lastSeen.current = Date.now(); setConnected(true);
        if (data.type === 'ready' || data.epoch !== epoch || data.revision !== revision.current) publish();
        else post('heartbeat');
      }
      if (data.type === 'closed' && popup.current === source) setConnected(false);
    };
    const leaving = () => post('disconnected');
    window.addEventListener('message', onMessage);
    window.addEventListener('pagehide', leaving);
    const monitor = window.setInterval(() => {
      if (!popup.current || popup.current.closed || Date.now() - lastSeen.current > 8000) setConnected(false);
    }, 1000);
    return () => {
      clearInterval(monitor);
      window.removeEventListener('message', onMessage); window.removeEventListener('pagehide', leaving);
      send.current = () => {};
    };
  }, [token, epoch]);

  useEffect(() => { revision.current++; send.current(); }, [snapshot]);

  function open() {
    if (popup.current && !popup.current.closed) { popup.current.focus(); send.current(); return true; }
    const url = new URL(location.href); url.search = ''; url.hash = '';
    url.searchParams.set('view', 'presenter'); url.searchParams.set('session', token);
    popup.current = window.open(url.toString(), `yusui-presenter-${epoch}`, 'popup=yes,width=1100,height=800,resizable=yes,scrollbars=yes');
    if (!popup.current) return false;
    popup.current.focus(); return true;
  }

  return { open, connected };
}
