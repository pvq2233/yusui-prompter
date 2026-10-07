import { test, expect, type Page } from '@playwright/test';

async function openPresenter(page: Page) {
  const created = page.waitForEvent('popup');
  await page.getByRole('button', { name: '主播窗口', exact: true }).click();
  const popup = await created;
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup.locator('article.current')).toBeVisible();
  return popup;
}

async function readingPosition(page: Page, selector: string) {
  return page.locator(selector).evaluate(box => {
    const y = box.getBoundingClientRect().top + box.clientHeight * .28;
    const spans = Array.from(box.querySelectorAll<HTMLElement>('[data-sentence-start]'));
    const nearest = spans.map(span => {
      const r = span.getBoundingClientRect();
      return { paragraph: span.closest<HTMLElement>('[data-paragraph]')!.dataset.paragraph, sentence: span.dataset.sentenceStart,
        distance: Math.max(r.top - y, y - r.bottom, 0) };
    }).sort((a, b) => a.distance - b.distance)[0];
    return [nearest.paragraph, nearest.sentence];
  });
}

test('presenter has only text, follows console jumps/styles, and reuses its window', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', {name:'跳转到第 4 段'}).click();
  const popup = await openPresenter(page);
  const unexpected: string[] = [];
  popup.on('request', request => { if (request.url().includes('/api/')) unexpected.push(request.url()); });
  popup.on('websocket', socket => unexpected.push(socket.url()));
  await expect(popup.locator('article.current')).toHaveAttribute('data-paragraph', '3');
  await expect(popup.locator('.sidebar,.app-header,.control-bar,.transcript-panel,.paragraph-label')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.control-bar')).toBeVisible();
  await page.getByRole('button', {name:'跳转到第 6 段'}).click();
  await expect(popup.locator('article.current')).toHaveAttribute('data-paragraph', '5');
  await page.getByRole('button', {name:'字号增大'}).click();
  await expect(popup.locator('.presenter-scroll')).toHaveCSS('font-size', '44px');
  await page.getByRole('button', {name:'镜像文字'}).click();
  await expect(popup.locator('.presenter-content')).toHaveClass(/mirrored/);
  await page.getByRole('button', {name:'镜像文字'}).click();
  const count = page.context().pages().length;
  await page.getByRole('button', {name:'主播窗口',exact:true}).click();
  expect(page.context().pages()).toHaveLength(count);
  await popup.setViewportSize({width:1920,height:1080});
  await expect.poll(() => readingPosition(popup, '.presenter-scroll')).toEqual(['5','0']);
  await popup.waitForTimeout(2500);
  await expect(popup.locator('.presenter-tools')).toHaveCSS('opacity','0');
  expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await popup.screenshot({path:'../presenter-preview.png'});
  await page.screenshot({path:'../console-preview.png'});
  expect(unexpected).toEqual([]);
  await popup.close();
});

test('console browsing leaves the presenter at its reading position; edits and reload still sync', async ({ page }) => {
  await page.goto('/');
  const popup = await openPresenter(page);
  await popup.setViewportSize({width:1000,height:760});
  await page.getByRole('button', {name:'跳转到第 3 段'}).click();
  await expect.poll(() => readingPosition(popup,'.presenter-scroll')).toEqual(['2','0']);
  await page.locator('.prompter-scroll').hover();
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(250);
  await expect(page.getByRole('button', {name:'回到跟读位置'})).toBeVisible();
  expect(await readingPosition(page,'.prompter-scroll')).not.toEqual(['2','0']);
  await expect.poll(() => readingPosition(popup,'.presenter-scroll')).toEqual(['2','0']);
  const held = await popup.locator('.presenter-scroll').evaluate(el => el.scrollTop);
  await page.waitForTimeout(1300);
  expect(await popup.locator('.presenter-scroll').evaluate(el => el.scrollTop)).toBeCloseTo(held,0);
  await page.getByRole('button',{name:'编辑讲稿',exact:true}).click();
  await page.getByRole('textbox',{name:'讲稿正文'}).fill('主播只看这段清爽的提词正文。\n\n中控继续在自己的屏幕选择章节。');
  await page.getByRole('button',{name:'保存并使用'}).click();
  await expect(popup.locator('.presenter-content')).toContainText('清爽的提词正文');
  await expect(popup.locator('article')).toHaveCount(2);
  await page.getByRole('button',{name:'跳转到第 2 段'}).click();
  await popup.reload();
  await expect(popup.locator('article.current')).toHaveAttribute('data-paragraph','1');
  await page.reload();
  await expect(popup.locator('article.current')).toHaveAttribute('data-paragraph','0');
  await popup.close();
  await expect(page.locator('.presenter-launch')).not.toHaveClass(/connected/);
  const reopened = await openPresenter(page);
  await expect(reopened.locator('.presenter-content')).toContainText('清爽的提词正文');
  await page.close();
  await expect(reopened.getByRole('status')).toContainText('中控连接已断开');
  await expect(reopened.locator('.presenter-content')).toContainText('清爽的提词正文');
  await reopened.close();
});

test('presenter keeps following while console browses and both honor explicit pause', async ({ page }) => {
  await page.goto('/');
  const popup = await openPresenter(page);
  await page.getByRole('button',{name:'体验跟读',exact:true}).click();
  await page.locator('.prompter-scroll').hover(); await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(200);
  const browsed = await page.locator('.prompter-scroll').evaluate(el => el.scrollTop);
  await expect.poll(() => popup.locator('[data-active-line="true"]').getAttribute('data-sentence-start'), {timeout:12000}).not.toBe('0');
  expect(await page.locator('.prompter-scroll').evaluate(el => el.scrollTop)).toBeCloseTo(browsed, 0);
  const sentence = await popup.locator('[data-active-line="true"]').getAttribute('data-sentence-start');
  await expect.poll(() => readingPosition(popup,'.presenter-scroll')).toEqual(['0',sentence!]);
  await page.getByRole('button',{name:'暂停跟读',exact:true}).click();
  await page.waitForTimeout(200);
  const position = await popup.locator('.presenter-scroll').evaluate(el => el.scrollTop);
  await page.waitForTimeout(1400);
  expect(await popup.locator('.presenter-scroll').evaluate(el => el.scrollTop)).toBeCloseTo(position,0);
  await page.getByRole('button',{name:'回到跟读位置',exact:true}).click();
  await expect(page.getByRole('button',{name:'恢复跟读',exact:true})).toBeVisible();
  await expect.poll(() => readingPosition(page,'.prompter-scroll')).toEqual(['0',sentence!]);
  await page.locator('.prompter-scroll').hover(); await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  expect(await popup.locator('.presenter-scroll').evaluate(el => el.scrollTop)).toBeCloseTo(position,0);
  await page.getByRole('button',{name:'跳转到第 5 段'}).click();
  await expect(popup.locator('article.current')).toHaveAttribute('data-paragraph','4');
  await popup.close();
});

test('a blocked popup reports recovery instructions without changing the console', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole('button',{name:'主播窗口',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('允许此站点弹出窗口');
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.app')).not.toHaveClass(/focus-mode/);
});
