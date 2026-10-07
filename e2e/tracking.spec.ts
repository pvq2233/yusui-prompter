import { test, expect } from '@playwright/test';

test('tracking tiers persist, restore, preserve pause, and fit both screen sizes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '跳转到第 3 段' }).click();
  await page.getByRole('button', { name: '暂停跟读', exact: true }).click();
  await page.getByRole('button', { name: '提词设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '提词设置' });
  await expect(dialog.getByRole('tab', { name: '跟踪策略' })).toHaveAttribute('aria-selected', 'true');
  await dialog.getByRole('group', { name: '文字相似度' }).getByRole('radio', { name: '宽松 65%' }).check();
  await dialog.getByRole('group', { name: '最大前跳距离' }).getByRole('radio', { name: '长距离 800 字' }).check();
  await dialog.getByRole('group', { name: '跨段搜索范围' }).getByRole('radio', { name: '较远 后 6 段' }).check();
  await dialog.getByRole('group', { name: '失配重定位' }).getByRole('radio', { name: '灵敏 1 次失配' }).check();
  await page.getByRole('button', { name: '关闭设置' }).click();
  await expect(page.locator('.follow-badge')).toHaveClass(/paused/);
  await expect(page.locator('article.current')).toHaveAttribute('data-paragraph', '2');
  await page.reload();
  await page.getByRole('button', { name: '提词设置', exact: true }).click();
  for (const name of ['宽松 65%', '长距离 800 字', '较远 后 6 段', '灵敏 1 次失配']) await expect(dialog.getByRole('radio', { name })).toBeChecked();
  await dialog.getByRole('button', { name: '恢复推荐' }).click();
  for (const name of ['均衡 77%', '中距离 300 字', '适中 后 3 段', '均衡 2 次失配']) await expect(dialog.getByRole('radio', { name })).toBeChecked();
  await page.screenshot({ path: '../tracking-settings-preview.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const modalWidth = await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  expect(modalWidth.scroll).toBeLessThanOrEqual(modalWidth.width);
  await dialog.getByRole('radio', { name: '谨慎 4 次失配' }).check();
  await page.screenshot({ path: '../tracking-settings-mobile.png', fullPage: true });
  await dialog.getByRole('tab', { name: '显示与语言' }).click();
  await expect(dialog.getByRole('slider', { name: '文字大小' })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: '识别语言' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('corrupt preferences recover and transcript mode explains policy scope', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('yusui-tracking', JSON.stringify({ similarity: -1, max_jump_chars: 800, recovery_misses: 'broken' })));
  await page.goto('/');
  await page.getByRole('button', { name: '实时转写', exact: true }).click();
  await page.getByRole('button', { name: '提词设置', exact: true }).click();
  await expect(page.getByRole('radio', { name: '均衡 77%' })).toBeChecked();
  await expect(page.getByRole('radio', { name: '长距离 800 字' })).toBeChecked();
  await expect(page.locator('.tracking-mode-note')).toContainText('这些设置用于「智能跟读」');
});
