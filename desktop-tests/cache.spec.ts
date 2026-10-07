import { test, expect, _electron } from '@playwright/test';
import http from 'node:http';
import path from 'node:path';

test('relaunch replaces cached HTML while retaining saved user data', async () => {
  // Simulate a previous server whose HTML was explicitly cacheable for a year.
  let version = 'old-editor';
  let htmlRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/api/status') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({app:'whisper-live-prompter'}));
    } else {
      htmlRequests++;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Cache-Control', 'public, max-age=31536000');
      response.end(`<html><body><h1>${version}</h1></body></html>`);
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(8768, '127.0.0.1', resolve); });
  const open = () => _electron.launch({ executablePath:path.join(process.cwd(),'client','语随.exe'),
    env:{...process.env,YUSUI_APP_ROOT:process.cwd(),YUSUI_DESKTOP_TEST:'1',YUSUI_PORT:'8768'} });
  try {
    const first = await open();
    try {
      const page = await first.firstWindow();
      await page.waitForURL('http://127.0.0.1:8768/');
      await expect(page.locator('h1')).toHaveText('old-editor');
      await page.evaluate(() => localStorage.setItem('saved-script', '请保留我的讲稿'));
    } finally { await first.close(); }
    version = 'manual-editor';
    const second = await open();
    try {
      const page = await second.firstWindow();
      await page.waitForURL('http://127.0.0.1:8768/');
      await expect(page.locator('h1')).toHaveText('manual-editor');
      expect(await page.evaluate(() => localStorage.getItem('saved-script'))).toBe('请保留我的讲稿');
      expect(htmlRequests).toBeGreaterThanOrEqual(2);
    } finally { await second.close(); }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
