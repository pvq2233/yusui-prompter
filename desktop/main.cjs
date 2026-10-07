const { app, BrowserWindow, ipcMain, Menu, session, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');

const root = process.env.YUSUI_APP_ROOT || (app.isPackaged ? path.dirname(path.dirname(process.execPath)) : path.dirname(__dirname));
const port = Number(process.env.YUSUI_PORT || 8765);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port');
const origin = `http://127.0.0.1:${port}`;
const testing = process.env.YUSUI_DESKTOP_TEST === '1';
const profile = path.join(root, 'data', testing ? 'desktop-test-profile' : 'desktop-profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.setName('语随提词器');
app.setAppUserModelId('local.yusui.prompter');
const loaderURL = pathToFileURL(path.join(__dirname, 'loading.html')).href;
const preload = path.join(__dirname, 'preload.cjs');
const owner = randomUUID();
const ownedStateFile = path.join(root, 'data', `desktop-server-${port}.json`);
const windows = new Set();
const windowKinds = new WeakMap();
const presenterPreferencesFile = path.join(profile, 'presenter-preferences.json');
let mainWindow, backendChild, ownedPid, closing = false, shutdownComplete = false;

function isLocal(url) {
  try { const parsed = new URL(url); return parsed.origin === origin && parsed.pathname === '/'; } catch { return false; }
}
function isPresenter(url) {
  try { const parsed = new URL(url); return isLocal(url) && parsed.searchParams.get('view') === 'presenter' && /^[a-zA-Z0-9-]{16,80}$/.test(parsed.searchParams.get('session') || ''); } catch { return false; }
}
function windowOptions(kind) {
  const base = kind === 'console' ? { width: 1440, height: 900, minWidth: 900, minHeight: 650 } : { width: 1100, height: 800, minWidth: 400, minHeight: 300 };
  let saved = {};
  try {
    const value = JSON.parse(fs.readFileSync(path.join(profile, `${kind}-window.json`), 'utf8'));
    if (['x','y','width','height'].every(key => Number.isFinite(value[key])) && screen.getAllDisplays().some(display => {
      const a = display.workArea;
      return value.x + value.width > a.x + 80 && value.x < a.x + a.width - 80 && value.y + value.height > a.y + 50 && value.y < a.y + a.height - 50;
    })) saved = { x: value.x, y: value.y, width: Math.max(base.minWidth, Math.min(5000, value.width)), height: Math.max(base.minHeight, Math.min(3000, value.height)) };
  } catch { /* First launch or a removed monitor: use centered defaults. */ }
  let alwaysOnTop = false;
  if (kind === 'presenter') {
    try { alwaysOnTop = JSON.parse(fs.readFileSync(presenterPreferencesFile, 'utf8')).alwaysOnTop === true; }
    catch { /* The presenter starts unpinned on first launch. */ }
  }
  return { ...base, ...saved, frame: false, show: false, alwaysOnTop, backgroundColor: '#111a16', title: kind === 'console' ? '语随 · 直播提词器' : '语随 · 主播窗口', icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } };
}
function windowState(win) { return { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), alwaysOnTop: win.isAlwaysOnTop() }; }
function configureWindow(win, kind) {
  windows.add(win);
  windowKinds.set(win, kind);
  win.setMenu(null);
  const saveBounds = () => {
    if (win.isDestroyed() || win.isFullScreen()) return;
    try { fs.writeFileSync(path.join(profile, `${kind}-window.json`), JSON.stringify(win.getNormalBounds())); }
    catch (error) { console.warn('Could not save window position:', error.message); }
  };
  win.on('close', saveBounds);
  win.on('closed', () => {
    windows.delete(win);
    if (kind === 'console') { for (const other of windows) if (!other.isDestroyed()) other.close(); app.quit(); }
  });
  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'always-on-top-changed']) win.on(event, () => win.webContents.send('desktop:state', windowState(win)));
  win.webContents.on('did-finish-load', () => win.webContents.send('desktop:state', windowState(win)));
  win.once('ready-to-show', () => { if (!testing) win.show(); });
}
function statusInLoader(message, error = false) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:loading', { message, error });
}
async function status() {
  try {
    const response = await fetch(`${origin}/api/status`, { signal: AbortSignal.timeout(1500) });
    try { return await response.json(); } catch { return { app: 'other-service' }; }
  } catch { return null; }
}
function adoptOwnedServer() {
  try {
    const state = JSON.parse(fs.readFileSync(ownedStateFile, 'utf8'));
    if (state.owner === owner && state.port === port && Number.isInteger(state.pid)) ownedPid = state.pid;
  } catch { /* Server has not written its startup record yet. */ }
}
async function ensureBackend() {
  const existing = await status();
  if (existing) {
    if (existing.app !== 'whisper-live-prompter') throw new Error(`本地端口 ${port} 正被其他程序使用，请关闭占用程序后重新启动。`);
    return;
  }
  const python = path.join(root, 'data', 'runtime', 'Scripts', 'python.exe');
  const requirementsHash = createHash('sha256').update(fs.readFileSync(path.join(root, 'requirements.txt'))).digest('hex');
  let installedHash = '';
  try { installedHash = fs.readFileSync(path.join(root, 'data', 'dependencies.sha256'), 'utf8').trim().toLowerCase(); } catch { /* First install. */ }
  const setup = !fs.existsSync(python) || installedHash !== requirementsHash;
  statusInLoader(setup ? '首次启动，正在准备本地识别环境…' : '正在启动 Whisper 本地服务…');
  const log = fs.openSync(path.join(root, 'data', 'desktop-service.log'), 'a');
  const env = { ...process.env, PROMPTER_DESKTOP_OWNER: owner, PROMPTER_PORT: String(port), PYTHONUNBUFFERED: '1' };
  backendChild = setup
    ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'start.ps1'), '-NoBrowser', '-Port', String(port)], { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] })
    : spawn(python, [path.join(root, 'server_runner.py'), '--port', String(port), '--device', 'auto'], { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  let spawnError;
  backendChild.once('error', error => { spawnError = error; });
  const until = Date.now() + (setup ? 10 * 60_000 : 30_000);
  while (Date.now() < until && !closing) {
    if (spawnError) throw new Error(`无法启动本地识别服务：${spawnError.message}`);
    adoptOwnedServer();
    const ready = await status();
    if (ready?.app === 'whisper-live-prompter') return;
    if (backendChild.exitCode !== null && !ownedPid) throw new Error('本地服务启动失败。请检查 data/desktop-service.log；首次启动需要联网下载运行环境与识别依赖。');
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('本地服务启动超时，请检查 data/desktop-service.log 后重新启动客户端。');
}
async function stopOwnedBackend() {
  adoptOwnedServer();
  const targets = new Set([ownedPid, backendChild?.exitCode === null ? backendChild.pid : undefined].filter(Number.isInteger));
  await Promise.all([...targets].map(pid => new Promise(resolve => {
    const task = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    task.once('error', resolve); task.once('exit', resolve);
    setTimeout(resolve, 4000).unref();
  })));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  app.on('web-contents-created', (_, contents) => {
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('will-navigate', (event, url) => { if (!isLocal(url) && url !== loaderURL) event.preventDefault(); });
    contents.setWindowOpenHandler(({ url }) => isPresenter(url) && mainWindow?.webContents === contents
      ? { action: 'allow', overrideBrowserWindowOptions: windowOptions('presenter') } : { action: 'deny' });
    contents.on('did-create-window', (win) => configureWindow(win, 'presenter'));
  });
  ipcMain.handle('desktop:window', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !windows.has(win) || event.senderFrame !== event.sender.mainFrame || (!isLocal(event.senderFrame.url) && event.senderFrame.url !== loaderURL)) throw new Error('Window command denied');
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') { win.close(); return; }
    else if (action === 'toggle-always-on-top') {
      if (windowKinds.get(win) !== 'presenter') throw new Error('Only the presenter window can be pinned');
      win.setAlwaysOnTop(!win.isAlwaysOnTop(), 'floating');
      try { fs.writeFileSync(presenterPreferencesFile, JSON.stringify({ alwaysOnTop: win.isAlwaysOnTop() })); }
      catch (error) { console.warn('Could not save presenter preferences:', error.message); }
    }
    else if (action !== 'state') throw new Error('Unknown window command');
    return windowState(win);
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const allowedPermission = (contents, permission, url, details = {}) => {
      if (!contents || !isLocal(url) || !windows.has(BrowserWindow.fromWebContents(contents))) return false;
      if (permission === 'fullscreen') return true;
      return permission === 'media' && contents === mainWindow?.webContents && details.mediaType !== 'video' && !(details.mediaTypes || []).includes('video');
    };
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) => allowedPermission(contents, permission, origin, details));
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(allowedPermission(contents, permission, details.requestingUrl || contents?.getURL(), details)));
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };
      if (details.url.startsWith(origin + '/')) headers['Content-Security-Policy'] = [`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:${port}; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'`];
      callback({ responseHeaders: headers });
    });
    mainWindow = new BrowserWindow(windowOptions('console'));
    configureWindow(mainWindow, 'console');
    await mainWindow.loadURL(loaderURL);
    try {
      // Older releases allowed Chromium to keep index.html fresh across updates.
      // Clear only HTTP resources; saved scripts/settings in localStorage stay intact.
      await session.defaultSession.clearCache();
      await ensureBackend();
      if (!closing && !mainWindow.isDestroyed()) await mainWindow.loadURL(origin);
    }
    catch (error) { statusInLoader(error.message, true); }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    stopOwnedBackend().finally(() => { shutdownComplete = true; app.quit(); });
  });
}
