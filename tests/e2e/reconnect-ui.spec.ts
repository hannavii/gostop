import { test, expect, noOverflow, playTurn, startRoom, type Peer } from './fixtures';

const notice = (peer: Peer) => peer.page.getByTestId('reconnect-notice');
const seconds = async (peer: Peer) => Number.parseInt(await notice(peer).getByTestId('reconnect-countdown').first().innerText());

test.describe('reconnect UI', () => {
  test.use({ scenario: 'reconnect' });
  for (const mode of ['matgo', 'gostop'] as const) {
    test(`${mode}: lobby host recovery, non-active progress, active wait and fresh countdowns`, async ({ createRoom, site }, testInfo) => {
      const peers = await createRoom(mode, { start: false }), host = peers[0], guest = peers[1];
      await host.page.getByRole('button', { name: '준비', exact: true }).click();
      await host.page.goto('about:blank');
      await expect.poll(() => guest.view!.connections[0].reconnectDeadline !== null).toBe(true);
      await expect(notice(guest)).toContainText('친구0님');
      await expect(notice(guest)).toContainText('재접속 대기 중');
      expect(guest.view!.host).toBe(0); expect(guest.view!.connections[0].ready).toBe(true);
      const first = await seconds(guest);
      await expect.poll(() => seconds(guest)).toBeLessThan(first);
      for (const peer of peers.slice(1)) {
        expect(peer.view!.connections[0].reconnectDeadline).toBe(guest.view!.connections[0].reconnectDeadline);
        await noOverflow(peer.page);
      }
      await host.page.goto(site);
      await expect(host.page.locator('.online-waiting-room')).toBeVisible();
      await expect(host.page.getByRole('button', { name: '준비 취소', exact: true })).toBeVisible();
      for (const peer of peers) await expect(notice(peer)).toHaveCount(0);
      expect(host.view!.you === 0 && host.view!.host === 0 && host.view!.connections[0].nickname === '친구0').toBe(true);
      await startRoom(peers);
      await expect.poll(() => peers.every(p => !!p.view!.game)).toBe(true);

      const turnDeadline = host.view!.turnTimer!.turnDeadline;
      await guest.page.goto('about:blank');
      await expect.poll(() => host.view!.connections[1].reconnectDeadline !== null).toBe(true);
      const previousDeadline = host.view!.connections[1].reconnectDeadline!;
      await expect(notice(host)).toContainText('차례는 계속 진행됩니다');
      expect(host.view!.turnTimer!.turnDeadline).toBe(turnDeadline);
      await expect(host.page.getByTestId('own-hand').locator('button.card').first()).toBeEnabled();
      // The connected actor can still complete its legitimate turn.
      await playTurn(peers);
      await expect(notice(host)).toContainText('친구1님의 재접속을 기다리는 중입니다.');
      await expect(host.page.getByRole('timer')).toHaveCount(0);
      await expect(host.page.getByTestId('own-hand').locator('button.card')).toHaveCount(0);
      for (const peer of peers.filter(p => p !== guest)) await noOverflow(peer.page);
      await guest.page.goto(site);
      await expect(guest.page.getByTestId('online-board')).toHaveAttribute('data-seat', '1');
      for (const peer of peers) await expect(notice(peer)).toHaveCount(0);
      await expect(guest.page.getByRole('timer')).toBeVisible();
      await playTurn(peers);

      // A second disconnect must use a new deadline, not the old countdown.
      await guest.page.goto('about:blank');
      await expect.poll(() => (host.view!.connections[1].reconnectDeadline ?? 0) > previousDeadline).toBe(true);
      expect(await seconds(host)).toBeGreaterThan(0);
      expect(await seconds(host)).toBeLessThanOrEqual(12);
      if (mode === 'gostop') {
        await peers[2].page.goto('about:blank');
        await expect(notice(host).getByTestId('reconnect-countdown')).toHaveCount(2);
        await expect(notice(host)).toContainText('친구2님');
      }
      await noOverflow(host.page);
      // The other requested portrait widths share the same actual disconnect state.
      if (testInfo.project.name === 'desktop') {
        for (const width of [375, 412]) {
          await host.page.setViewportSize({ width, height: 844 });
          await noOverflow(host.page);
          const box = await notice(host).boundingBox();
          expect(box !== null && box.x >= 0 && box.x + box.width <= width).toBe(true);
        }
      }
      for (const peer of peers.slice(1)) {
        await peer.page.goto(site);
        await expect(peer.page.getByTestId('online-board')).toBeVisible();
      }
      for (const peer of peers) {
        await expect(notice(peer)).toHaveCount(0);
        expect(peer.view!.connections.every(c => c.connected && c.reconnectDeadline === null)).toBe(true);
      }
    });
  }
});

test.describe('server grace expiry', () => {
  test.use({ scenario: 'reconnect-expiry' });
  for (const mode of ['matgo', 'gostop'] as const) {
    test(`${mode}: expiry closes the game with a reason and clears countdowns`, async ({ createRoom }) => {
      const peers = await createRoom(mode), observer = peers[0];
      await peers[1].page.goto('about:blank');
      await expect(notice(observer)).toBeVisible();
      await expect(observer.page.getByTestId('online-board')).toHaveCount(0);
      await expect(observer.page.getByRole('status')).toContainText('친구1님의 재접속 대기 시간이 만료되어 방이 종료되었습니다.');
      await expect(observer.page.getByTestId('reconnect-countdown')).toHaveCount(0);
      expect(await observer.page.evaluate(() => sessionStorage.getItem('gostop.online.reconnect') === null)).toBe(true);
    });
  }
  test('lobby expiry removes only the expired host and then transfers ownership', async ({ createRoom }) => {
    const peers = await createRoom('gostop', { start: false }), observer = peers[1];
    await peers[0].page.goto('about:blank');
    await expect(notice(observer)).toBeVisible(); expect(observer.view!.host).toBe(0);
    await expect.poll(() => observer.view!.occupancy).toBe(2);
    await expect(observer.page.locator('.online-waiting-room')).toBeVisible();
    await expect(notice(observer)).toHaveCount(0);
    expect(observer.view!.connections[observer.view!.host].nickname).toBe('친구1');
  });
});
