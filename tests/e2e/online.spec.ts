import { test, expect, noOverflow, playTurn, settled, type Peer } from './fixtures';
import type { GameMode } from '../../src/game/rules';

async function privacy(peers: Peer[]) {
  for (const peer of peers) {
    const view = peer.view!, game = view.game!;
    const otherIds = peers.filter(p => p !== peer).flatMap(p => p.view!.game!.hand.map(card => card.id));
    // Boolean assertions avoid dumping complete room projections into failure reports.
    expect(!('pile' in game) && !('pending' in game) && !('token' in view)).toBe(true);
    expect(game.players.every(player => !('hand' in player))).toBe(true);
    expect(otherIds.every(id => !JSON.stringify(view).includes(`"${id}"`))).toBe(true);
    const domIds = await peer.page.locator('.card').evaluateAll(cards => cards.map(card =>
      `${parseInt(card.querySelector('.card-month')!.textContent!)}-${card.querySelector('.card-index')!.textContent!.trim()}`));
    expect(otherIds.every(id => !domIds.includes(id))).toBe(true);
    await expect(peer.page.getByTestId('own-hand').locator('.card')).toHaveCount(game.hand.length);
    await expect(peer.page.locator('.opponent-area .card, .gostop3-opponents-area .card')).toHaveCount(0);
    await noOverflow(peer.page);
  }
}

async function sessionDigest(peer: Peer) {
  return peer.page.evaluate(async () => {
    const raw = sessionStorage.getItem('gostop.online.reconnect');
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (Object.keys(value).sort().join(',') !== 'roomCode,token' || !/^[a-f0-9]{64}$/.test(value.token)) return null;
    // Only a one-way digest crosses into the runner; credentials stay in the page.
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))))
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
  });
}

async function watchAnimation(peer: Peer) {
  await peer.page.evaluate(() => {
    const state = { flights: 0, duplicates: false };
    const observer = new MutationObserver(() => {
      const flights = [...document.querySelectorAll('.flying-face--front .card, .capture-flight-layer .card')];
      const destinations = [...document.querySelectorAll('.floor-cards .floor-card-slot > .card, .ppeok-stack-cards .card, .captured-panel .card, .player-area .card')];
      state.flights += flights.length;
      state.duplicates ||= flights.some(card => destinations.some(other => card.textContent === other.textContent));
    });
    observer.observe(document.querySelector('[data-testid="online-board"]')!, { childList: true, subtree: true, attributes: true });
    Object.assign(window, { e2eAnimation: state, e2eObserver: observer });
  });
}

for (const mode of ['matgo', 'gostop'] as GameMode[]) {
  test(`${mode}: lobby, private hands, reload recovery, seat order and presentation`, async ({ createRoom }) => {
    const peers = await createRoom(mode);
    await privacy(peers);
    const before = peers[0].view!;
    const digest = await sessionDigest(peers[0]); expect(digest !== null).toBe(true);
    const errors: string[] = [];
    for (const peer of peers) peer.page.on('pageerror', () => errors.push('Browser JavaScript exception'));
    await peers[0].page.reload();
    await expect(peers[0].page.getByTestId('online-board')).toHaveAttribute('data-seat', '0');
    await expect(peers[0].page.getByRole('heading', { name: /친구0 \(나\)/ })).toBeVisible();
    await expect.poll(() => peers[0].view!.connections[0].connected).toBe(true);
    expect((await sessionDigest(peers[0])) === digest).toBe(true);
    expect(peers[0].view!.code === before.code).toBe(true);
    expect(JSON.stringify(peers[0].view!.game) === JSON.stringify(before.game)).toBe(true);
    for (const peer of peers) await watchAnimation(peer);
    // Matgo: 0→1→0. Gostop: 0→1→2→0, using actual DOM actions.
    for (let seat = 0; seat < peers.length; seat++) {
      expect(peers[0].view!.game!.turn).toBe(seat);
      await playTurn(peers);
      await expect.poll(() => peers.every(p => p.view!.game!.turn === (seat + 1) % peers.length)).toBe(true);
      for (const peer of peers) { await settled(peer); await noOverflow(peer.page); }
    }
    for (const peer of peers) {
      const animation = await peer.page.evaluate(() => {
        const state = window as unknown as { e2eAnimation: { flights: number; duplicates: boolean }; e2eObserver: MutationObserver };
        state.e2eObserver.disconnect(); return state.e2eAnimation;
      });
      expect(animation.flights).toBeGreaterThan(0);
      expect(animation.duplicates).toBe(false);
    }
    expect(errors.length).toBe(0);
  });
}

test.describe('stable server settlement fixture', () => {
  test.use({ scenario: 'rematch' });
  for (const mode of ['matgo', 'gostop'] as GameMode[]) {
    test(`${mode}: unanimous rematch preserves identities and resets the game`, async ({ createRoom, site }) => {
      const peers = await createRoom(mode), before = peers.map(p => p.view!);
      await peers[0].page.getByRole('button', { name: 'STOP', exact: true }).click();
      for (const peer of peers) {
        await expect(peer.page.locator('.game-over-modal')).toBeVisible();
        await noOverflow(peer.page);
      }
      await peers[0].page.goto('about:blank');
      await expect(peers[1].page.locator('.rematch-status').getByTestId('connection-0')).toContainText('재접속 대기 중');
      // A disconnected previous actor must not prevent another seat's rematch vote.
      await peers[1].page.getByRole('button', { name: '다시하기', exact: true }).click();
      await peers[1].page.getByRole('button', { name: '다시하기 취소', exact: true }).click();
      await peers[0].page.goto(site);
      await expect(peers[0].page.locator('.game-over-modal')).toBeVisible();
      await expect(peers[1].page.getByTestId('reconnect-notice')).toHaveCount(0);
      await peers[0].page.getByRole('button', { name: '다시하기', exact: true }).click();
      await expect.poll(() => peers.every(p => p.view!.connections[0].rematchReady)).toBe(true);
      expect(peers.every(p => p.view!.round === 1 && p.view!.game!.phase === 'finished')).toBe(true);
      for (const peer of peers.slice(1)) await peer.page.getByRole('button', { name: '다시하기', exact: true }).click();
      await expect.poll(() => peers.every(p => p.view!.round === 2)).toBe(true);
      for (let seat = 0; seat < peers.length; seat++) {
        const peer = peers[seat], view = peer.view!, game = view.game!;
        expect(view.code === before[seat].code && view.you === seat).toBe(true);
        expect(view.connections.every((p, i) => p.nickname === before[seat].connections[i].nickname && !p.rematchReady)).toBe(true);
        expect(game.phase).toBe('play'); expect(game.turn).toBe(0);
        expect(game.result === null && game.choice === null && game.revealed.length === 0 && game.specialEvents.length === 0).toBe(true);
        expect(game.players.every(p => !p.captured.length && !p.goCount && !p.bombCount && !p.bombPassCount && !p.shakeMonths.length)).toBe(true);
        expect(game.revision > before[seat].game!.revision).toBe(true);
        await expect(peer.page.locator('.game-over-modal')).toHaveCount(0);
        await noOverflow(peer.page);
      }
      await privacy(peers);
      await playTurn(peers);
    });
  }
});

test.describe('server-only short deadline injection', () => {
  test.use({ scenario: 'timer' });
  for (const mode of ['matgo', 'gostop'] as GameMode[]) {
    test(`${mode}: countdown, active disconnect pause, resume and automatic next turn`, async ({ createRoom, site }) => {
      const peers = await createRoom(mode), active = peers[0], observer = peers[1];
      await expect(active.page.getByRole('timer')).toContainText(/친구0님 차례.*[0-3]초/);
      const initial = active.view!, originalDeadline = initial.turnTimer!.turnDeadline;
      expect(peers.every(p => p.view!.turnTimer!.turnDeadline === originalDeadline)).toBe(true);
      const digest = await sessionDigest(active);
      // Navigating away closes the real transport, keeping this tab's origin storage.
      await active.page.goto('about:blank');
      await expect.poll(() => !observer.view!.connections[0].connected && observer.view!.turnTimer === null).toBe(true);
      // Wait across the actual cancelled deadline, rather than an arbitrary sleep.
      await expect.poll(() => Date.now() > originalDeadline + 100, { timeout: 5000 }).toBe(true);
      expect(observer.view!.game!.revision).toBe(initial.game!.revision);
      await active.page.goto(site);
      await expect(active.page.getByTestId('online-board')).toHaveAttribute('data-seat', '0');
      expect((await sessionDigest(active)) === digest).toBe(true);
      await expect.poll(() => observer.view!.connections[0].connected && !!observer.view!.turnTimer).toBe(true);
      expect(observer.view!.turnTimer!.turnDeadline > originalDeadline).toBe(true);
      const initialSeconds = Number.parseInt(await observer.page.getByRole('timer').locator('strong').innerText());
      await expect.poll(async () => observer.view!.game!.revision === initial.game!.revision &&
        Number.parseInt(await observer.page.getByRole('timer').locator('strong').innerText()) < initialSeconds).toBe(true);
      await expect.poll(() => peers.every(p => p.view!.game!.revision > initial.game!.revision && p.view!.game!.turn === 1)).toBe(true);
      for (const peer of peers) { await settled(peer); await noOverflow(peer.page); }
      expect(peers.every(p => p.view!.turnTimer!.timedPlayerSeat === 1)).toBe(true);
    });
  }
});
