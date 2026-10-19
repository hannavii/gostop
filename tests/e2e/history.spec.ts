import { test, expect, noOverflow } from './fixtures';
import { HISTORY_KEY } from '../../src/online/recentGameHistory';

test.use({ scenario: 'history' });
for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: personal history, spectator exclusion, reload and rematch`, async ({ createRoom, openPeer }, testInfo) => {
    test.setTimeout(25_000);
    const peers = [...await createRoom(mode)];
    const spectator = await openPeer();
    await spectator.page.locator('.online-mode-entry').click();
    await spectator.page.getByLabel('방 코드', { exact: true }).fill(peers[0].view!.code);
    await spectator.page.getByRole('button', { name: '관전하기', exact: true }).click();
    await expect.poll(() => spectator.spectatorView?.game?.phase).toBe('go-stop');
    await peers[0].page.getByRole('button', { name: 'STOP', exact: true }).click();
    await expect.poll(() => peers.every(p => !!p.view?.completedResult)).toBe(true);
    const id = peers[0].view!.completedResult!.id;
    for (const [seat, peer] of peers.entries()) {
      const saved = await peer.page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), HISTORY_KEY);
      expect(saved.length).toBe(1); expect(saved[0].you).toBe(seat);
      expect(saved[0].record).toEqual(peer.view!.completedResult);
      await peer.page.getByRole('button', { name: '최근 경기', exact: true }).click();
      await expect(peer.page.locator('.recent-game h2')).toContainText(seat === 0 ? '승' : '패');
      await peer.page.getByRole('button', { name: '상세 보기' }).click();
      await expect(peer.page.getByTestId('settlement-total')).toBeVisible();
      const widths = testInfo.project.name === 'desktop' ? [375, 412, 1440] : [peer.page.viewportSize()!.width];
      for (const width of widths) {
        await peer.page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
        await noOverflow(peer.page);
      }
      await peer.page.getByRole('button', { name: '최근 경기 목록' }).click();
      await peer.page.getByRole('button', { name: '온라인으로' }).click();
    }
    expect(await spectator.page.evaluate(key => localStorage.getItem(key), HISTORY_KEY)).toBeNull();
    expect(spectator.spectatorView).not.toHaveProperty('completedResult');
    await peers[0].page.reload();
    await expect.poll(() => peers[0].view?.completedResult?.id).toBe(id);
    await expect(peers[0].page.getByRole('button', { name: '다시하기', exact: true })).toBeVisible();
    for (const peer of peers) await peer.page.getByRole('button', { name: '다시하기', exact: true }).click();
    await expect.poll(() => peers.every(p => p.view?.round === 2)).toBe(true);
    await peers[0].page.getByRole('button', { name: 'STOP', exact: true }).click();
    await expect.poll(() => peers[0].view?.completedResult?.round).toBe(2);
    for (const peer of peers) {
      const saved = await peer.page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), HISTORY_KEY);
      expect(saved.length).toBe(2); expect(new Set(saved.map((e: { record: { id: string } }) => e.record.id)).size).toBe(2);
    }
  });
}

test('corrupted history and empty history stay usable', async ({ openPeer }) => {
  const peer = await openPeer();
  await peer.page.evaluate(key => localStorage.setItem(key, '{broken'), HISTORY_KEY);
  await peer.page.locator('.online-mode-entry').click();
  await peer.page.getByRole('button', { name: '최근 경기', exact: true }).click();
  await expect(peer.page.getByText('아직 저장된 경기가 없습니다.')).toBeVisible();
  await noOverflow(peer.page);
});
