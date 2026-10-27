import { test, expect, noOverflow, playTurn, settled } from './fixtures';
import { findSameMonthCards } from '../../src/game/matching';

test.use({ scenario: 'beginner' });

for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: personal help, turn updates, privacy, spectator and reload`, async ({ createRoom, openPeer }) => {
    const players = [...await createRoom(mode, { beginnerHelpEnabled: true })];
    const host = players[0], page = host.page;
    await settled(host);
    expect(host.view!.beginnerHelpEnabled).toBe(true);
    await expect(page.locator('.help-highlight')).toHaveCount(0);
    const revision = host.view!.game!.revision;
    await page.getByRole('button', { name: '도움말 켜기', exact: true }).click();
    await expect(page.getByTestId('own-hand').locator('.help-highlight')).toHaveCount(host.view!.game!.hand.length);
    const game = host.view!.game!;
    const floorIds = new Set(game.hand.flatMap(card => findSameMonthCards(card, game.floor).map(c => c.id)));
    expect(floorIds.size).toBeGreaterThan(0);
    await expect(page.locator('.floor-cards .help-highlight')).toHaveCount(floorIds.size);
    const border = await page.getByTestId('own-hand').locator('.help-highlight').first().evaluate(card => {
      const style = getComputedStyle(card);
      return { color: style.outlineColor, width: style.outlineWidth };
    });
    expect(border).toEqual({ color: 'rgb(255, 212, 59)', width: '3px' });
    await page.getByRole('button', { name: '도움말 끄기', exact: true }).click();
    await expect(page.locator('.help-highlight')).toHaveCount(0);
    await page.getByRole('button', { name: '도움말 켜기', exact: true }).click();
    expect(host.view!.game!.revision).toBe(revision);
    for (const width of [360, 375, 390, 412, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await noOverflow(page);
      await expect(page.getByRole('button', { name: '도움말 끄기', exact: true })).toBeVisible();
    }
    for (const peer of players.slice(1)) {
      await expect(peer.page.locator('.help-highlight')).toHaveCount(0);
      await peer.page.getByRole('button', { name: '도움말 켜기', exact: true }).click();
      await expect(peer.page.locator('.help-highlight')).toHaveCount(0);
      expect(peer.view!.game!.players.every(p => !('hand' in p))).toBe(true);
      expect(!('pile' in peer.view!.game!) && !('pending' in peer.view!.game!)).toBe(true);
    }
    const observer = await openPeer();
    await observer.page.locator('.online-mode-entry').click();
    await observer.page.getByLabel('방 코드', { exact: true }).fill(host.view!.code);
    await observer.page.getByRole('button', { name: '관전하기', exact: true }).click();
    await expect(observer.page.getByTestId('spectator-board')).toBeVisible();
    await expect(observer.page.getByRole('button', { name: /도움말/ })).toHaveCount(0);
    await expect(observer.page.locator('.help-highlight')).toHaveCount(0);
    expect(observer.spectatorView!.game!.hand.length).toBe(0);
    const privateIds = players.flatMap(p => p.view!.game!.hand.map(card => card.id));
    expect(privateIds.every(id => !JSON.stringify(observer.spectatorView).includes(`"${id}"`))).toBe(true);
    await playTurn(players);
    await settled(host);
    await expect(page.locator('.help-highlight')).toHaveCount(0);
    await settled(players[1]);
    await expect(players[1].page.getByTestId('own-hand').locator('.help-highlight')).toHaveCount(players[1].view!.game!.hand.length);
    await page.reload();
    await expect(page.getByTestId('online-board')).toBeVisible();
    expect(host.view!.beginnerHelpEnabled).toBe(true);
    await expect(page.getByRole('button', { name: '도움말 켜기', exact: true })).toBeVisible();
    await expect(page.locator('.help-highlight')).toHaveCount(0);
  });
}

test('default room has no help toggle', async ({ createRoom }) => {
  const peers = await createRoom('matgo');
  for (const peer of peers) {
    expect(peer.view!.beginnerHelpEnabled).toBe(false);
    await expect(peer.page.getByRole('button', { name: /도움말/ })).toHaveCount(0);
  }
});

test.describe('rematch', () => {
  test.use({ scenario: 'rematch' });
  test('room permission survives finish and rematch; personal toggle resets', async ({ createRoom }) => {
    const peers = [...await createRoom('matgo', { beginnerHelpEnabled: true })];
    await peers[0].page.getByRole('button', { name: 'STOP', exact: true }).click();
    for (const p of peers) {
      await expect(p.page.locator('.game-over-modal')).toBeVisible();
      await expect(p.page.locator('.help-highlight')).toHaveCount(0);
      await p.page.getByRole('button', { name: '다시하기', exact: true }).click();
    }
    for (const p of peers) {
      await expect(p.page.getByTestId('online-board')).toHaveAttribute('data-round', '2');
      expect(p.view!.beginnerHelpEnabled).toBe(true);
      await expect(p.page.getByRole('button', { name: '도움말 켜기', exact: true })).toBeVisible();
    }
  });
});
