import { test, expect, noOverflow } from './fixtures';

for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: no deal or automatic action before start; keyboard start and normal play`, async ({ openPeer }) => {
    const { page } = await openPeer();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.getByRole('button', { name: mode === 'matgo' ? 'AI 2인 맞고' : 'AI 3인 고스톱', exact: true }).click();
    const start = page.getByRole('button', { name: '게임 시작', exact: true });
    await expect(start).toBeVisible();
    await expect(page.locator('.game .card, .game .card-back')).toHaveCount(0);
    const before = await page.locator('main.game').innerText();
    await page.clock.runFor(10_000);
    expect(await page.locator('main.game').innerText()).toBe(before);
    await expect(page.locator('.game .card, .game .card-back')).toHaveCount(0);
    for (const width of [360, 375, 390, 412, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await noOverflow(page);
      await expect(start).toBeInViewport();
      const box = (await start.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      const back = (await page.getByRole('button', { name: '게임 선택' }).boundingBox())!;
      expect(box.x + box.width <= back.x || back.x + back.width <= box.x).toBe(true);
    }
    await start.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(start).toBeFocused();
    await expect(start).toHaveCSS('outline-style', 'solid');
    await start.press(mode === 'matgo' ? 'Enter' : 'Space');
    await expect(page.getByRole('button', { name: '게임 시작', exact: true })).toHaveCount(0);
    await expect(page.locator('.player-area .card')).toHaveCount(mode === 'matgo' ? 10 : 7);
    await expect(page.locator('.opponent-area .card-back, .gostop3-opponent-hand .card-back')).toHaveCount(mode === 'matgo' ? 10 : 14);
    await expect(page.locator('.floor-cards .card')).toHaveCount(mode === 'matgo' ? 8 : 6);
    await expect(page.locator('.draw-pile-area')).toContainText(mode === 'matgo' ? '더미 20장' : '더미 21장');
    for (const width of [360, 375, 390, 412, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await noOverflow(page);
    }
    const hand = page.locator('.player-area button.card');
    await hand.first().click();
    const normal = page.getByRole('button', { name: '그냥 한 장 내기', exact: true });
    if (await normal.isVisible()) await normal.click();
    await expect(page.locator('main.game')).toHaveClass(/is-animating/);
    await page.getByRole('button', { name: '게임 선택' }).click();
    await page.clock.runFor(10_000);
    await expect(page.getByRole('button', { name: '온라인 플레이', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('gostop: repeated start clicks deal once and intentional restart deals once more', async ({ openPeer }) => {
  const { page } = await openPeer();
  await page.clock.install();
  await page.evaluate(() => {
    const original = Math.random;
    Object.assign(window, { dealRandomCalls: 0 });
    Math.random = () => {
      if (new Error().stack?.includes('shuffleCards')) {
        const counter = window as unknown as { dealRandomCalls: number };
        counter.dealRandomCalls++;
      }
      return original();
    };
  });
  const calls = () => page.evaluate(() => (window as unknown as { dealRandomCalls: number }).dealRandomCalls);
  await page.getByRole('button', { name: 'AI 3인 고스톱', exact: true }).click();
  await page.clock.runFor(10_000);
  expect(await calls()).toBe(0);
  await page.getByRole('button', { name: '게임 시작', exact: true }).dblclick();
  expect(await calls()).toBe(47); // One Fisher-Yates shuffle for 48 cards.
  await expect(page.locator('.gostop3-player-hand .card')).toHaveCount(7);
  await expect(page.locator('.gostop3-opponent-hand .card-back')).toHaveCount(14);
  await expect(page.locator('.floor-cards .card')).toHaveCount(6);
  await expect(page.locator('.draw-pile-area')).toContainText('더미 21장');
  await page.getByRole('button', { name: '다시 시작', exact: true }).click();
  expect(await calls()).toBe(94);
  await expect(page.locator('.gostop3-player-hand .card')).toHaveCount(7);
  await page.getByRole('button', { name: '게임 선택' }).click();
  await page.getByRole('button', { name: 'AI 3인 고스톱', exact: true }).click();
  await expect(page.getByRole('button', { name: '게임 시작', exact: true })).toBeVisible();
  await page.clock.runFor(10_000);
  expect(await calls()).toBe(94);
  await expect(page.locator('.game .card, .game .card-back')).toHaveCount(0);
});
