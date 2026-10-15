import { test, expect, noOverflow, playTurn, settled } from './fixtures';

for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: identical ordered logs, presentation, mobile panel and reload recovery`, async ({ createRoom }, testInfo) => {
    const peers = await createRoom(mode);
    for (const peer of peers) {
      expect(peer.view!.logs!.map(e => e.type)).toEqual(['start']);
      await peer.page.getByTestId('game-log-toggle').click();
      await expect(peer.page.getByTestId('game-log-panel')).toBeVisible();
      await peer.page.evaluate(() => {
        const state = { early: false };
        const observer = new MutationObserver(() => {
          const board = document.querySelector<HTMLElement>('[data-testid="online-board"]');
          if (!board?.classList.contains('is-animating')) return;
          const revision = Number(board.dataset.revision);
          state.early ||= [...document.querySelectorAll<HTMLElement>('[data-log-revision]')]
            .some(entry => Number(entry.dataset.logRevision) >= revision);
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true });
        Object.assign(window, { logPresentation: state, logObserver: observer });
      });
    }
    for (let seat = 0; seat < peers.length; seat++) {
      await playTurn(peers);
      for (const peer of peers) await settled(peer);
      const expected = JSON.stringify(peers[0].view!.logs);
      await expect.poll(() => peers.every(p => JSON.stringify(p.view!.logs) === expected)).toBe(true);
      for (const peer of peers) {
        const ids = await peer.page.getByTestId('game-log-entry').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-log-id')));
        expect(ids).toEqual(peer.view!.logs!.map(entry => entry.id).reverse());
        expect(new Set(ids).size).toBe(ids.length);
        await noOverflow(peer.page);
      }
    }
    for (const peer of peers) {
      expect(await peer.page.evaluate(() => {
        const state = window as unknown as { logPresentation: { early: boolean }; logObserver: MutationObserver };
        state.logObserver.disconnect(); return state.logPresentation.early;
      })).toBe(false);
    }
    const oldIds = peers[0].view!.logs!.map(entry => entry.id);
    await peers[1].page.reload();
    await expect(peers[1].page.getByTestId('online-board')).toBeVisible();
    await expect.poll(() => peers.every(p => p.view!.logs!.some(e => e.type === 'reconnect' && e.playerSeat === 1))).toBe(true);
    const restored = JSON.stringify(peers[1].view!.logs);
    await expect.poll(() => peers.every(p => JSON.stringify(p.view!.logs) === restored)).toBe(true);
    expect(peers[1].view!.logs!.slice(0, oldIds.length).map(e => e.id)).toEqual(oldIds);
    await peers[1].page.getByTestId('game-log-toggle').click();
    const count = peers[0].view!.logs!.length;
    for (const peer of peers) await peer.page.getByRole('button', { name: '새로고침', exact: true }).click();
    expect(peers.every(p => p.view!.logs!.length === count)).toBe(true);

    const viewer = peers[0];
    const widths = testInfo.project.name === 'desktop' ? [375, 412, 1440] : [viewer.page.viewportSize()!.width];
    for (const width of widths) {
      if (testInfo.project.name === 'desktop') await viewer.page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await viewer.page.getByTestId('game-log-toggle').scrollIntoViewIfNeeded();
      await noOverflow(viewer.page);
      expect(await viewer.page.getByTestId('game-log-panel').evaluate(element => {
        const log = element.getBoundingClientRect();
        return [...document.querySelectorAll('.player-area, .floor-cards, .go-stop-buttons, .special-action-buttons')].every(target => {
          const r = target.getBoundingClientRect();
          return log.right <= r.left || log.left >= r.right || log.bottom <= r.top || log.top >= r.bottom;
        });
      })).toBe(true);
      await viewer.page.getByTestId('game-log-toggle').click();
      await expect(viewer.page.getByTestId('game-log-panel')).toHaveCount(0);
      await viewer.page.getByTestId('game-log-toggle').click();
    }
  });
}
