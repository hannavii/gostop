import { expect, type Page } from '@playwright/test';
import { test as fixtureTest } from './fixtures';

type Mode = 'matgo' | 'gostop';
type Prompt = 'none' | 'choose' | 'special' | 'go-stop' | 'finished';

async function mount(page: Page, mode: Mode, crowded: boolean, prompt: Prompt = 'none') {
  await page.evaluate(async options => {
    const path = '/tests/ai-captured-layout-fixture.tsx';
    const fixture = await import(/* @vite-ignore */ path);
    fixture.mountAiCapturedLayout(options);
  }, { mode, crowded, prompt });
  await expect(page.locator('#ai-layout-fixture main')).toBeVisible();
  await expect(page.locator('#ai-layout-fixture .captured-panel')).toHaveCount(mode === 'matgo' ? 2 : 3);
  await expect(page.locator('#ai-layout-fixture .captured-panel-header').first()).toContainText(crowded ? '48장' : '0장');
}

async function layout(page: Page) {
  const result = await page.locator('#ai-layout-fixture main').evaluate(main => {
    const box = (element: Element) => element.getBoundingClientRect();
    const overlap = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    const panels = [...main.querySelectorAll<HTMLElement>('.captured-panel')];
    const protectedAreas = [...main.querySelectorAll('.player-area, .table, .opponent-area, .gostop3-opponents-area, .turn-message, .start-button, .gostop3-restart-button')];
    return {
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      panelOverflow: panels.some(p => p.scrollWidth > p.clientWidth + 1),
      panelOverlap: panels.some((p, index) => panels.slice(index + 1).some(q => overlap(box(p), box(q)))),
      playOverlap: panels.some(p => protectedAreas.some(q => overlap(box(p), box(q)))),
      outside: panels.some(p => box(p).left < -1 || box(p).right > innerWidth + 1 || box(p).bottom > innerHeight + 1),
      handOutside: box(main.querySelector('.player-area')!).bottom > innerHeight + 1,
      tableHeight: box(main.querySelector('.table')!).height,
      captureAnchor: (() => {
        const panel = main.querySelector('.captured-panel--right, .gostop3-captured-panel--player')!;
        const rect = box(panel), style = getComputedStyle(main);
        return Math.abs(parseFloat(style.getPropertyValue('--ai-capture-player-x')) - (rect.left + rect.width / 2)) < 1 &&
          Math.abs(parseFloat(style.getPropertyValue('--ai-capture-player-y')) - (rect.top + rect.height / 2)) < 1;
      })(),
    };
  });
  expect(result).toEqual({ pageOverflow: false, panelOverflow: false, panelOverlap: false, playOverlap: false, outside: false, handOutside: false, captureAnchor: true, tableHeight: expect.any(Number) });
  expect(result.tableHeight).toBeGreaterThan(140);
}

for (const mode of ['matgo', 'gostop'] as const) {
  fixtureTest(`${mode}: empty and crowded captured panels leave hand, floor and actions reachable`, async ({ openPeer }) => {
    const { page } = await openPeer();
    for (const width of [360, 375, 390, 412]) {
      await page.setViewportSize({ width, height: width === 360 ? 800 : 844 });
      for (const crowded of [false, true]) {
        await mount(page, mode, crowded);
        await layout(page);
        const panels = page.locator('#ai-layout-fixture .captured-panel');
        if (crowded) {
          await expect(panels.first().locator('.captured-row')).toHaveCount(4);
          await expect(panels.first().locator('.captured-mini-card')).toHaveCount(48);
          await panels.first().focus();
          await page.keyboard.press('End');
          await expect.poll(() => panels.first().evaluate(p => p.scrollTop)).toBeGreaterThan(0);
          await panels.first().press('Enter');
          await expect(page.getByRole('dialog')).toContainText('48장');
          await page.getByRole('button', { name: '먹은 패 크게 보기 닫기', exact: true }).click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
        }
        const hand = page.locator('#ai-layout-fixture .player-area .card-row');
        await hand.evaluate(e => { e.scrollLeft = e.scrollWidth; });
        await hand.locator('button.card').last().click();
        await expect(page.getByTestId('layout-action')).not.toBeEmpty();
        await page.locator('#ai-layout-fixture main > button').click();
        await expect(page.getByTestId('layout-action')).toHaveText('restart');
      }
      await mount(page, mode, true, 'choose');
      await layout(page);
      await page.locator('#ai-layout-fixture .floor-cards button.selectable').first().click();
      await expect(page.getByTestId('layout-action')).toHaveText('choose');
      for (const prompt of ['go-stop', 'special', 'finished'] as const) {
        await mount(page, mode, true, prompt);
        const dialog = page.getByRole('dialog');
        for (const button of await dialog.getByRole('button').all()) {
          await button.click();
          await expect(page.getByTestId('layout-action')).not.toBeEmpty();
        }
      }
    }
  });

  fixtureTest(`${mode}: real pre-game and started board retain accessible captured panels`, async ({ openPeer }) => {
    const { page } = await openPeer();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole('button', { name: mode === 'matgo' ? 'AI 2인 맞고' : 'AI 3인 고스톱', exact: true }).click();
    await expect(page.getByRole('button', { name: '게임 시작', exact: true })).toBeInViewport();
    await expect(page.locator('.captured-panel:visible')).toHaveCount(0);
    await page.getByRole('button', { name: '게임 시작', exact: true }).click();
    await expect(page.locator('.captured-panel:visible')).toHaveCount(mode === 'matgo' ? 2 : 3);
    await page.getByRole('button', { name: '내 먹은 패 자세히 보기' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '먹은 패 크게 보기 닫기', exact: true }).click();
    await page.locator('.player-area button.card').first().click();
    const normal = page.getByRole('button', { name: '그냥 한 장 내기', exact: true });
    if (await normal.isVisible()) await normal.click();
    await expect(page.locator('main.game')).toHaveClass(/is-animating/);
  });

  fixtureTest(`${mode}: desktop keeps fixed panel positions and original card size`, async ({ openPeer }) => {
    const { page } = await openPeer();
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const crowded of [false, true]) {
      await mount(page, mode, crowded);
      const panels = page.locator('#ai-layout-fixture .captured-panel');
      for (const panel of await panels.all()) {
        await expect(panel).toHaveCSS('position', 'fixed');
        expect((await panel.boundingBox())!.width).toBeCloseTo(1440 * .18, 0);
      }
      if (crowded) {
        const card = panels.first().locator('.captured-mini-card').first();
        await expect(card).toHaveCSS('width', '30px');
        await expect(card).toHaveCSS('height', '39px');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}

