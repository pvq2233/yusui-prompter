import { test, expect } from '@playwright/test';

test('manual paragraph navigation, pause, editor persistence, and search', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始识别', exact: true })).toBeEnabled({ timeout: 15000 });
  await page.getByRole('button', { name: '跳转到第 4 段', exact: true }).click();
  await expect(page.locator('.stage-bottom')).toContainText('第 4 段');
  await expect(page.locator('article.current')).toHaveAttribute('data-paragraph', '3');
  await page.getByRole('button', { name: '暂停跟读', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复跟读', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '编辑讲稿', exact: true }).click();
  await page.getByRole('textbox', { name: '讲稿正文', exact: true }).fill('第一段：欢迎来到测试直播。\n\n第二段：手动跳转应当立即生效。\n\n第三段：感谢大家。');
  await page.getByRole('button', { name: '保存并使用' }).click();
  await expect(page.locator('.stage-bottom')).toContainText('共 3 段');
  await page.reload();
  await page.getByRole('textbox', { name: '搜索段落' }).fill('跳转');
  await expect(page.locator('.nav-item')).toHaveCount(1);
  await page.getByRole('button', { name: '跳转到第 2 段' }).click();
  await expect(page.locator('article.current')).toContainText('手动跳转');
  expect(errors).toEqual([]);
});

test('demo keeps tracking during manual browsing and returns to the current reading position', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '体验跟读', exact: true }).click();
  await expect(page.locator('.follow-badge')).toContainText('非语音识别');
  await page.getByRole('button', { name: '跳转到第 5 段' }).click();
  await expect(page.locator('.stage-bottom')).toContainText('第 5 段');
  const initialSentence = await page.locator('[data-active-line="true"]').getAttribute('data-sentence-start');
  await page.locator('.prompter-scroll').hover(); await page.mouse.wheel(0, 190);
  await page.waitForTimeout(200);
  const before = await page.locator('.prompter-scroll').evaluate(el => el.scrollTop);
  await expect.poll(() => page.locator('[data-active-line="true"]').getAttribute('data-sentence-start'), {timeout:8000}).not.toBe(initialSentence);
  expect(await page.locator('.prompter-scroll').evaluate(el => el.scrollTop)).toBeCloseTo(before, 0);
  await expect(page.locator('.follow-badge')).toContainText('浏览中 · 演示继续');
  await expect(page.getByRole('button', { name: '暂停跟读', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '回到跟读位置', exact: true }).click();
  await expect(page.getByRole('button', { name: '回到跟读位置', exact: true })).toHaveCount(0);
  const readingDistance = await page.locator('.prompter-scroll').evaluate(box => Math.abs(box.querySelector('[data-active-line="true"]')!.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight * .28));
  expect(readingDistance).toBeLessThan(3);
  await page.getByRole('button', { name: '镜像文字' }).click();
  await expect(page.locator('.prompter-content')).toHaveClass(/mirrored/);
  await page.getByRole('button', { name: '专注模式', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.getByRole('button', { name: '退出专注', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
});

test('returning from browsing does not resume an explicit pause; navigation reattaches the viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '跳转到第 4 段' }).click();
  await page.getByRole('button', { name: '暂停跟读', exact: true }).click();
  await page.locator('.prompter-scroll').hover(); await page.mouse.wheel(0, 600);
  await page.getByRole('button', { name: '回到跟读位置', exact: true }).click();
  await expect(page.locator('.follow-badge')).toHaveClass(/paused/);
  await expect(page.getByRole('button', { name: '恢复跟读', exact: true })).toBeVisible();
  const readingDistance = await page.locator('.prompter-scroll').evaluate(box => Math.abs(box.querySelector('[data-active-line="true"]')!.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight * .28));
  expect(readingDistance).toBeLessThan(3);
  await page.locator('.prompter-scroll').hover(); await page.mouse.wheel(0, -400);
  await expect(page.getByRole('button', { name: '回到跟读位置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '跳转到第 6 段' }).click();
  await expect(page.getByRole('button', { name: '回到跟读位置', exact: true })).toHaveCount(0);
  await expect(page.locator('article.current')).toHaveAttribute('data-paragraph', '5');
});

test('desktop and small screen layout contain the controls', async ({ page }) => {
  await page.goto('/');
  for (const size of [{width:1440,height:900},{width:1920,height:1080},{width:390,height:844}]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const start = page.getByRole('button', {name:'开始识别',exact:true});
    await expect(start).toBeVisible();
    const box = await start.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
  }
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'../prompter-preview.png',fullPage:true});
});
