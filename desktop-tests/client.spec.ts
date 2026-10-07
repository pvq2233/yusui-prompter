import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { APPEARANCE_PRESETS, DEFAULT_APPEARANCE, READING_FONTS } from '../src/appearance';

const root = process.cwd();
const base = 'http://127.0.0.1:8766';
async function launch() {
  const client = await _electron.launch({ executablePath: path.join(root, 'client', '语随.exe'),
    args: process.env.TEST_AUDIO_PATH ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${process.env.TEST_AUDIO_PATH}`] : [],
    env: { ...process.env, YUSUI_DESKTOP_TEST: '1', YUSUI_PORT: '8766', YUSUI_APP_ROOT: root }, timeout: 30000 });
  const page = await client.firstWindow();
  await page.waitForURL(base + '/', { timeout: 30000 });
  await expect(page.locator('.app')).toBeVisible();
  const native = await client.browserWindow(page);
  await native.evaluate(win => win.show()); await native.dispose();
  return { client, page };
}
async function presenter(client: ElectronApplication, page: Page) {
  const ready = client.waitForEvent('window');
  await page.getByRole('button', { name: '主播窗口', exact: true }).click();
  const popup = await ready;
  await expect(popup.locator('article.current')).toBeVisible();
  return popup;
}

test('reading appearance syncs presets and custom colors, preserves pause and browsing, and survives restart', async () => {
  let opened = await launch();
  let running = true;
  const rgb = (hex: string) => 'rgb(' + [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)).join(', ') + ')';
  try {
    const { client, page } = opened;
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('yusui-appearance', JSON.stringify({font:'missing',text:'invalid',highlight:'#bad',background:null})); });
    await page.reload();
    const popup = await presenter(client,page);
    await expect(page.locator('.prompter-shell')).toHaveCSS('background-color',rgb(DEFAULT_APPEARANCE.background));
    await page.getByRole('button',{name:'暂停跟读',exact:true}).click();
    await page.locator('.prompter-scroll').hover(); await page.mouse.wheel(0,50);
    await page.getByRole('button',{name:'提词设置',exact:true}).click();
    await page.getByRole('tab',{name:'字体与颜色',exact:true}).click();
    for (const preset of APPEARANCE_PRESETS) {
      await page.getByRole('button',{name:preset.name,exact:true}).click();
      await expect(page.getByRole('button',{name:preset.name,exact:true})).toHaveAttribute('aria-pressed','true');
      for (const surface of [page,popup]) {
        await expect(surface.locator('.reading-appearance')).toHaveCSS('background-color',rgb(preset.value.background));
        await expect(surface.locator('.current-sentence')).toHaveCSS('color',rgb(preset.value.highlight));
        await expect(surface.locator('article.current')).toHaveCSS('color',rgb(preset.value.text));
        const font = READING_FONTS.find(f => f.id === preset.value.font)!;
        await expect.poll(() => surface.locator(surface === page ? '.prompter-scroll' : '.presenter-scroll').evaluate(el => getComputedStyle(el).fontFamily)).toContain(font.family.split(',')[0].replaceAll('"',''));
      }
    }
    await page.getByRole('button',{name:'暖纸书页',exact:true}).click();
    await page.screenshot({path:'../appearance-settings-preview.png'});
    await popup.screenshot({path:'../appearance-paper-presenter.png'});
    await page.getByRole('combobox',{name:'提词字体',exact:true}).selectOption('fangsong');
    await page.getByLabel('正文颜色',{exact:true}).fill('#b8c9db');
    await page.getByLabel('当前句高亮',{exact:true}).fill('#ffe8aa');
    await page.getByLabel('画面背景',{exact:true}).fill('#151a24');
    const custom = {font:'fangsong',text:'#b8c9db',highlight:'#ffe8aa',background:'#151a24'};
    await expect(page.locator('.appearance-heading small')).toHaveText('自定义配色');
    await expect(page.locator('.appearance-preset[aria-pressed=true]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('yusui-appearance')!))).toEqual(custom);
    await expect(popup.locator('.current-sentence')).toHaveCSS('color',rgb(custom.highlight));
    await expect(page.getByRole('button',{name:'恢复跟读',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();
    await expect(page.getByRole('button',{name:'回到跟读位置',exact:true})).toBeVisible();
    // Font and palette changes do not seek or unpause either display.
    await expect(page.locator('[data-active-line=true]')).toHaveAttribute('data-sentence-start','0');
    await page.getByRole('button',{name:'体验跟读',exact:true}).click();
    await page.locator('.prompter-scroll').hover(); await page.mouse.wheel(0,50);
    const before = await page.locator('[data-active-line=true]').textContent();
    await expect.poll(() => popup.locator('[data-active-line=true]').textContent(),{timeout:12000}).not.toBe(before);
    await page.getByRole('button',{name:'停止演示',exact:true}).click();
    await expect(page.getByRole('button',{name:'回到跟读位置',exact:true})).toBeVisible();
    await client.close(); running = false;
    opened = await launch(); running = true;
    const restored = await presenter(opened.client,opened.page);
    await expect(opened.page.locator('.prompter-shell')).toHaveCSS('background-color',rgb(custom.background));
    await expect(restored.locator('.current-sentence')).toHaveCSS('color',rgb(custom.highlight));
    await expect.poll(() => restored.locator('.presenter-scroll').evaluate(el => getComputedStyle(el).fontFamily)).toContain('FangSong');
    await opened.page.getByRole('button',{name:'提词设置',exact:true}).click();
    await opened.page.getByRole('tab',{name:'字体与颜色',exact:true}).click();
    await expect(opened.page.getByRole('combobox',{name:'提词字体',exact:true})).toHaveValue('fangsong');
    // A small client still exposes every control via the settings scroll area.
    const native = await opened.client.browserWindow(opened.page);
    await native.evaluate(win => { win.unmaximize(); win.setSize(900,650); }); await native.dispose();
    await opened.page.getByRole('button',{name:'清晰黑白',exact:true}).click();
    await opened.page.getByRole('button',{name:'恢复默认',exact:true}).click();
    await expect(restored.locator('.presenter-screen')).toHaveCSS('background-color',rgb(DEFAULT_APPEARANCE.background));
    await expect(opened.page.getByRole('button',{name:'森林微光',exact:true})).toHaveAttribute('aria-pressed','true');
    await opened.page.getByLabel('正文颜色',{exact:true}).fill(DEFAULT_APPEARANCE.background);
    await expect(opened.page.getByRole('status').filter({hasText:'文字与背景比较接近'})).toBeVisible();
    await opened.page.getByRole('button',{name:'恢复默认',exact:true}).click();
    await expect(opened.page.locator('.appearance-contrast')).toHaveCount(0);
    await opened.page.screenshot({path:'../appearance-small-window.png'});
  } finally { if (running) await opened.client.close(); }
});

test('presenter pin changes native z-order, survives fullscreen and restart, and leaves console unpinned', async () => {
  let opened = await launch();
  let running = true;
  try {
    fs.writeFileSync(path.join(root,'data','desktop-test-profile','presenter-preferences.json'), JSON.stringify({alwaysOnTop:false}));
    const {client,page} = opened;
    let popup = await presenter(client,page);
    let native = await client.browserWindow(popup);
    await native.evaluate(win => { win.show(); win.focus(); });
    await expect(popup.getByRole('button',{name:'主播窗口置顶',exact:true})).toHaveAttribute('aria-pressed','false');
    expect(await native.evaluate(win => win.isAlwaysOnTop())).toBe(false);
    await popup.getByRole('button',{name:'主播窗口置顶',exact:true}).click();
    await expect(popup.getByRole('button',{name:'取消主播窗口置顶',exact:true})).toHaveAttribute('aria-pressed','true');
    expect(await native.evaluate(win => win.isAlwaysOnTop())).toBe(true);
    const consoleNative = await client.browserWindow(page);
    await consoleNative.evaluate(win => win.focus());
    expect(await consoleNative.evaluate(win => win.isAlwaysOnTop())).toBe(false);
    await consoleNative.dispose();
    await popup.getByRole('button',{name:'主播窗口全屏',exact:true}).click();
    await expect.poll(() => popup.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await popup.getByRole('button',{name:'退出主播全屏',exact:true}).click();
    await expect.poll(() => popup.evaluate(() => !!document.fullscreenElement)).toBe(false);
    expect(await native.evaluate(win => win.isAlwaysOnTop())).toBe(true);
    await popup.screenshot({path:'../presenter-pinned-preview.png'});
    await popup.getByRole('button',{name:'关闭窗口',exact:true}).click();
    await expect.poll(() => client.windows().length).toBe(1);
    await native.dispose();
    popup = await presenter(client,page); native = await client.browserWindow(popup);
    expect(await native.evaluate(win => win.isAlwaysOnTop())).toBe(true);
    await native.dispose();
    // Narrow IPC must not allow the operator window to pin itself.
    expect(await page.evaluate(async () => {
      try { await window.yusuiDesktop!.window('toggle-always-on-top'); return 'allowed'; }
      catch { return 'denied'; }
    })).toBe('denied');
    await client.close(); running = false;
    opened = await launch(); running = true;
    popup = await presenter(opened.client,opened.page); native = await opened.client.browserWindow(popup);
    await native.evaluate(win => { win.show(); win.focus(); });
    await expect(popup.getByRole('button',{name:'取消主播窗口置顶',exact:true})).toHaveAttribute('aria-pressed','true');
    expect(await native.evaluate(win => win.isAlwaysOnTop())).toBe(true);
    // Pointer movement reveals the controls after their usual idle timeout.
    await popup.waitForTimeout(1900);
    await popup.mouse.move(30,100); await popup.mouse.move(50,100);
    await expect(popup.locator('.presenter-screen')).toHaveClass(/show-controls/);
    await popup.getByRole('button',{name:'取消主播窗口置顶',exact:true}).click();
    await expect(popup.getByRole('button',{name:'主播窗口置顶',exact:true})).toHaveAttribute('aria-pressed','false');
    expect(await native.evaluate(win => win.isAlwaysOnTop())).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(root,'data','desktop-test-profile','presenter-preferences.json'),'utf8')).alwaysOnTop).toBe(false);
    await native.dispose();
  } finally { if (running) await opened.client.close(); }
});

test('guide triangle seeks the visible wrapped sentence and synchronizes the presenter', async () => {
  const {client,page} = await launch();
  try {
    await page.evaluate(() => localStorage.clear()); await page.reload();
    const prefix = '这一句是段落的开头。';
    const target = '这一句是要通过横线选中的长句，需要在窗口里折成多行，点击三角形后应定位到这句话的开头，并且让主播窗口同步到同一句话。';
    await page.getByRole('button', {name:'编辑讲稿',exact:true}).click();
    await page.getByRole('textbox', {name:'讲稿正文',exact:true}).fill('开场第一句。欢迎大家来到直播间。\n\n' + prefix + target + '这是下一句。\n\n结束段落。感谢观看。');
    await page.getByRole('button', {name:'保存并使用'}).click();
    const popup = await presenter(client,page);
    const selector = `article[data-paragraph="1"] [data-sentence-start="${prefix.length}"]`;
    for (const mirror of [false, true]) {
      if (mirror) await page.getByRole('button',{name:'镜像文字',exact:true}).click();
      await page.getByRole('button',{name:'跳转到第 1 段',exact:true}).click();
      await page.locator('.prompter-scroll').evaluate((box, selected) => {
        const rects = Array.from(box.querySelector(selected)!.getClientRects());
        const rect = rects[Math.floor(rects.length / 2)];
        const line = document.querySelector('.reading-guide i')!.getBoundingClientRect();
        box.scrollTop += rect.top + rect.height / 2 - line.top;
      },selector);
      await page.locator('.prompter-scroll').hover(); await page.mouse.wheel(0,1);
      await expect(page.getByRole('button',{name:'回到跟读位置',exact:true})).toBeVisible();
      const button = page.getByRole('button',{name:'跳转到横线处的句子',exact:true});
      await button.hover();
      await expect(button).toHaveCSS('cursor','pointer');
      await page.mouse.down(); await expect(button).toHaveCSS('background-color',await page.locator('.app').evaluate(el=>{const hex=getComputedStyle(el).getPropertyValue('--ui-accent').trim();return 'rgb('+[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')+')';}));
      await page.mouse.up();
      await expect(page.locator(selector)).toHaveAttribute('data-active-line','true');
      await expect(popup.locator(selector)).toHaveAttribute('data-active-line','true');
      await expect(page.getByRole('button',{name:'回到跟读位置',exact:true})).toHaveCount(0);
      if (!mirror) await page.screenshot({path:'../guide-jump-preview.png'});
    }
    // Empty space between paragraphs resolves to the nearest text, not its label.
    await page.locator('.prompter-scroll').evaluate(box => {
      const text = box.querySelector('article[data-paragraph="2"] [data-sentence-start="0"]')!.getBoundingClientRect();
      const line = document.querySelector('.reading-guide i')!.getBoundingClientRect();
      box.scrollTop += text.top - 8 - line.top;
    });
    await page.getByRole('button',{name:'跳转到横线处的句子',exact:true}).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('article.current')).toHaveAttribute('data-paragraph','2');
    await page.locator('.view-tabs').getByRole('button',{name:'实时转写',exact:true}).click();
    await expect(page.getByRole('button',{name:'跳转到横线处的句子',exact:true})).toHaveCount(0);
  } finally { await client.close(); }
});

test('native window controls, independent presenter, local storage, and owned service shutdown', async () => {
  const { client, page } = await launch();
  let closed = false;
  try {
    await page.evaluate(() => localStorage.clear()); await page.reload();
    await expect(page.locator('html')).toHaveClass(/desktop-app/);
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
    await page.getByRole('button', { name: '最大化窗口', exact: true }).click();
    await expect(page.getByRole('button', { name: '还原窗口', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '还原窗口', exact: true }).click();
    const native = await client.browserWindow(page);
    await page.getByRole('button', { name: '最小化窗口', exact: true }).click();
    await expect.poll(() => native.evaluate(win => win.isMinimized())).toBe(true);
    await native.evaluate(win => { win.restore(); win.show(); });
    await page.getByRole('button', { name: '跳转到第 4 段' }).click();
    const popup = await presenter(client, page);
    await expect(popup.locator('article.current')).toHaveAttribute('data-paragraph', '3');
    await expect(popup.locator('.sidebar,.app-header,.control-bar')).toHaveCount(0);
    await expect(popup.getByRole('button', { name: '关闭窗口', exact: true })).toHaveCount(1);
    const popupNative = await client.browserWindow(popup);
    await popupNative.evaluate(win => { win.setBounds({ x: 100, y: 120, width: 1050, height: 720 }); win.show(); });
    // Fractional Windows display scaling can round a requested size by one DIP.
    const bounds = await popupNative.evaluate(win => win.getBounds());
    expect(bounds).toMatchObject({ x:100, y:120 });
    expect(Math.abs(bounds.width - 1050)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds.height - 720)).toBeLessThanOrEqual(1);
    await popup.getByRole('button', { name: '主播窗口全屏', exact: true }).click();
    await expect.poll(() => popup.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await popup.getByRole('button', { name: '退出主播全屏', exact: true }).click();
    await expect.poll(() => popup.evaluate(() => !!document.fullscreenElement)).toBe(false);
    await page.getByRole('button', { name: '跳转到第 6 段' }).click();
    await expect(popup.locator('article.current')).toHaveAttribute('data-paragraph','5');
    await page.locator('.prompter-scroll').hover(); await page.mouse.wheel(0, -650);
    await expect(page.getByRole('button', { name: '回到跟读位置' })).toBeVisible();
    await expect(popup.locator('article.current')).toHaveAttribute('data-paragraph','5');
    await page.getByRole('button', { name: '字号增大' }).click();
    await expect(popup.locator('.presenter-scroll')).toHaveCSS('font-size','44px');
    await page.screenshot({ path: '../desktop-console-preview.png' });
    await popup.screenshot({ path: '../desktop-presenter-preview.png' });
    await popup.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await expect.poll(() => client.windows().length).toBe(1);
    expect(await page.evaluate(() => window.open('https://example.com') === null)).toBe(true);
    expect(await page.evaluate(() => window.open(location.origin + '/?view=presenter&session=invalid') === null)).toBe(true);
    await page.reload();
    await expect(page.locator('.font-number')).toHaveText('44');
    const exported = path.join(root, 'data', 'desktop-test-profile', 'exported-script.txt');
    await client.evaluate(({ session }, filename) => {
      session.defaultSession.once('will-download', (_, item) => item.setSavePath(filename));
    }, exported);
    await page.getByRole('button', {name:'导出讲稿',exact:true}).click();
    await expect.poll(() => fs.existsSync(exported) ? fs.readFileSync(exported,'utf8') : '').toContain('大家晚上好');
    await native.evaluate(win => win.setSize(900, 650));
    const closeBounds = await page.getByRole('button', {name:'关闭窗口',exact:true}).boundingBox();
    expect(closeBounds!.x + closeBounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
    await presenter(client, page);
    await popupNative.dispose(); await native.dispose();
    const exited = client.waitForEvent('close');
    await page.getByRole('button', { name:'关闭窗口',exact:true }).click();
    await exited; closed = true;
  } finally { if (!closed) await client.close(); }
  await expect.poll(async () => { try { await fetch(base + '/api/status'); return true; } catch { return false; } }, { timeout: 10000 }).toBe(false);
});

test('packaged client captures microphone audio and follows real Whisper small in both windows', async () => {
  test.skip(!process.env.TEST_AUDIO_PATH, 'Provide a local spoken WAV for the fake microphone.');
  const { client, page } = await launch();
  try {
    await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.getByRole('button', {name:'编辑讲稿',exact:true}).click();
    await page.getByRole('button', {name:'手动分段',exact:true}).click();
    await page.getByRole('textbox', {name:'第 1 段正文',exact:true}).fill('大家晚上好，\n\n欢迎来到今天的直播。');
    await page.getByRole('button', {name:'在第 1 段后新增段落',exact:true}).click();
    await page.getByRole('textbox', {name:'第 2 段正文',exact:true}).fill('今天想和大家聊一件很简单的事，怎样把一场直播讲得更自然。我们不需要记住每一个字，只需要知道自己想表达什么，然后把话说清楚。');
    await page.getByRole('button', {name:'保存并使用'}).click();
    const popup = await presenter(client, page);
    await expect(page.getByRole('button', {name:'开始识别',exact:true})).toBeEnabled({timeout:30000});
    await page.getByRole('button', {name:'开始识别',exact:true}).click();
    await expect(page.getByRole('button', {name:'停止识别',exact:true})).toBeVisible({timeout:10000});
    await page.locator('.prompter-scroll').hover();
    const wheelTarget = await page.locator('.prompter-scroll').evaluate(el => Math.min(el.scrollTop + 600, el.scrollHeight - el.clientHeight));
    await page.mouse.wheel(0, 600);
    await expect(page.getByRole('button', {name:'回到跟读位置'})).toBeVisible();
    await expect.poll(() => page.locator('.prompter-scroll').evaluate(el => el.scrollTop)).toBeCloseTo(wheelTarget, 0);
    const browsed = await page.locator('.prompter-scroll').evaluate(el => el.scrollTop);
    await expect(page.locator('.transcript-feed')).toContainText('大家', {timeout:20000});
    await expect(popup.locator('article.current')).toHaveAttribute('data-paragraph','1', {timeout:20000});
    expect(await page.locator('.prompter-scroll').evaluate(el => el.scrollTop)).toBeCloseTo(browsed,0);
    await page.getByRole('button', {name:'回到跟读位置'}).click();
    await page.getByRole('button', {name:'停止识别',exact:true}).click();
    await expect(page.getByRole('button', {name:'开始识别',exact:true})).toBeEnabled({timeout:20000});
    await expect(page.locator('.message-bar.error')).toHaveCount(0);
  } finally { await client.close(); }
});

test('manual editor preserves explicit blocks, mode drafts, cancellation, persistence and presenter sync', async () => {
  const {client,page} = await launch();
  try {
    const native = await client.browserWindow(page);
    await native.evaluate(win => win.setSize(1200, 850)); await native.dispose();
    await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.getByRole('button', {name:'编辑讲稿',exact:true}).click();
    const dialog = page.getByRole('dialog', {name:'编辑讲稿'});
    const original = await dialog.getByRole('textbox', {name:'讲稿正文',exact:true}).inputValue();
    await dialog.getByRole('button', {name:'手动分段',exact:true}).click();
    await expect(dialog.locator('textarea')).toHaveCount(1);
    await expect(dialog.locator('textarea')).toHaveValue('');
    await expect(dialog.getByRole('button', {name:'删除第 1 段',exact:true})).toBeDisabled();
    await dialog.getByRole('button', {name:'保存并使用'}).click();
    await expect(dialog.getByRole('alert')).toContainText('至少填写一个段落');
    const first = '第一框的开场。\n\n粘贴的空行仍属于第一段。';
    await dialog.getByRole('textbox', {name:'第 1 段正文',exact:true}).fill(first);
    await dialog.getByRole('button', {name:'在第 1 段后新增段落',exact:true}).click();
    await expect(dialog.getByRole('textbox', {name:'第 2 段正文',exact:true})).toBeFocused();
    await dialog.getByRole('textbox', {name:'第 2 段正文',exact:true}).fill('最后一段，感谢观看。');
    await dialog.getByRole('button', {name:'在第 1 段后新增段落',exact:true}).click();
    await dialog.getByRole('textbox', {name:'第 2 段正文',exact:true}).fill('将被删除的中间段。');
    await dialog.getByRole('button', {name:'删除第 2 段',exact:true}).click();
    await expect(dialog.getByRole('textbox', {name:'第 2 段正文',exact:true})).toHaveValue('最后一段，感谢观看。');
    await dialog.getByRole('button', {name:'默认分段',exact:true}).click();
    await expect(dialog.getByRole('textbox', {name:'讲稿正文',exact:true})).toHaveValue(original);
    await dialog.getByRole('button', {name:'手动分段',exact:true}).click();
    await expect(dialog.getByRole('textbox', {name:'第 1 段正文',exact:true})).toHaveValue(first);
    await dialog.getByRole('button', {name:'在第 2 段后新增段落',exact:true}).click();
    await dialog.screenshot({path:'../manual-editor-preview.png'});
    await dialog.getByRole('button', {name:'保存并使用'}).click();
    await expect(page.locator('.nav-item')).toHaveCount(2);
    const popup = await presenter(client,page);
    await expect(popup.locator('article')).toHaveCount(2);
    await page.getByRole('button', {name:'跳转到第 2 段',exact:true}).click();
    await expect(popup.locator('article.current')).toContainText('感谢观看');
    await page.reload();
    await expect(page.locator('.nav-item')).toHaveCount(2);
    await page.getByRole('button', {name:'编辑讲稿',exact:true}).click();
    await expect(dialog.getByRole('button', {name:'手动分段',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(dialog.locator('textarea')).toHaveCount(2);
    await expect(dialog.getByRole('textbox', {name:'第 1 段正文',exact:true})).toHaveValue(first);
    await dialog.getByRole('button', {name:'删除第 1 段',exact:true}).click();
    await dialog.getByRole('button', {name:'取消',exact:true}).click();
    await expect(page.locator('.nav-item')).toHaveCount(2);
    await page.getByRole('button', {name:'编辑讲稿',exact:true}).click();
    await expect(dialog.locator('textarea')).toHaveCount(2);
    await dialog.getByRole('button', {name:'默认分段',exact:true}).click();
    await dialog.getByRole('textbox', {name:'讲稿正文',exact:true}).fill('默认第一段。\n\n默认第二段。\n\n默认第三段。');
    await dialog.getByRole('button', {name:'保存并使用'}).click();
    await expect(page.locator('.nav-item')).toHaveCount(3);
    await expect(popup.locator('article')).toHaveCount(3);
  } finally { await client.close(); }
});
