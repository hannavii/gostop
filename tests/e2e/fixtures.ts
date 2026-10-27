import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createOnlineServer } from '../../server/app';
import { createMatch, type Match } from '../../server/game';
import { TurnTimer } from '../../server/turnTimer';
import { hwatuCards } from '../../src/data/cards';
import { GAME_RULES, type GameMode } from '../../src/game/rules';
import type { ChatState, RoomView, SpectatorRoomView } from '../../shared/online';
import { settlementMatch } from '../settlement-fixture';

type Scenario = 'beginner' | 'history' | 'normal' | 'timer' | 'rematch' | 'reconnect' | 'reconnect-expiry' | 'settlement';
export type Peer = { page: Page; context: BrowserContext; view: RoomView | null; spectatorView?: SpectatorRoomView; chat?: ChatState };
type Fixtures = {
  scenario: Scenario;
  site: string;
  peers: Peer[];
  openPeer: (url?: string) => Promise<Peer>;
  createRoom: (mode: GameMode, options?: { start?: boolean; beginnerHelpEnabled?: boolean }) => Promise<Peer[]>;
};

// Complete, non-overlapping fixed deal: first actions have no ambiguous matches.
// Only the E2E process imports this factory; there is no HTTP/Socket fixture endpoint.
function fixedMatch(mode: GameMode, finishedSoon: boolean): Match {
  const match = createMatch(mode), rules = GAME_RULES[mode];
  if (finishedSoon) {
    const captured = hwatuCards.filter(card => card.category === 'gwang');
    const remaining = hwatuCards.filter(card => !captured.includes(card));
    match.players.forEach((player, seat) => { player.hand = [remaining[seat]]; });
    match.players[0].captured = captured;
    match.floor = remaining.slice(rules.playerCount, rules.playerCount + 3);
    match.pile = remaining.slice(rules.playerCount + 3);
    match.phase = 'go-stop';
  } else {
    match.players.forEach((player, seat) => {
      player.hand = hwatuCards.slice(seat * rules.handSize, (seat + 1) * rules.handSize);
    });
    const dealt = rules.playerCount * rules.handSize;
    match.floor = hwatuCards.slice(dealt, dealt + rules.floorSize);
    match.pile = hwatuCards.slice(dealt + rules.floorSize);
  }
  return match;
}

// Observe only the real public room projection. Never retain room:session frames.
function observe(peer: Peer) {
  const packet = (payload: string) => {
    for (const part of payload.split('\x1e')) {
      if (!part.startsWith('42[')) continue;
      const [event, view] = JSON.parse(part.slice(2));
      if (event === 'chat:state') { peer.chat = view; continue; }
      if (event === 'room:spectator-state') { peer.spectatorView = view; continue; }
      if (event !== 'room:state') continue;
      const next = view as RoomView, old = peer.view;
      if (old?.code === next.code && (old.round > next.round || old.round === next.round &&
        (old.game?.revision ?? -1) > (next.game?.revision ?? -1))) continue;
      peer.view = next;
    }
  };
  peer.page.on('websocket', socket => socket.on('framereceived', event => {
    packet(typeof event.payload === 'string' ? event.payload : event.payload.toString());
  }));
  peer.page.on('response', async response => {
    if (response.request().method() !== 'GET' || !response.url().includes('/socket.io/?')) return;
    try { packet(await response.text()); } catch { /* Aborted polling on reload. */ }
  });
}

export const test = base.extend<Fixtures>({
  scenario: ['normal', { option: true }],
  site: async ({ scenario }, provide) => {
    let deals = 0;
    const allowedOrigins: string[] = [];
    const server = createOnlineServer({
      reconnectGraceMs: scenario === 'reconnect-expiry' ? 1800 : scenario === 'reconnect' ? 12_000 : undefined,
      connectionPolicy: { allowedOrigins, allowMissingOrigin: false },
      matchFactory: (mode = "matgo") => scenario === 'settlement' && deals++ === 0
        ? settlementMatch(mode) : (() => {
          const match = fixedMatch(mode, scenario === 'history' || scenario === 'rematch' && deals++ === 0);
          if (scenario === 'beginner') {
            const hand = match.players[0].hand;
            [hand[hand.length - 1], match.floor[0]] = [match.floor[0], hand[hand.length - 1]];
          }
          return match;
        })(),
      turnTimerFactory: () => scenario === 'timer' ? new TurnTimer(2500) : new TurnTimer(),
    });
    let vite: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
      const target = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
      vite = await createServer({ configFile: false, plugins: [react()],
        // Ignore developer .env files: tests always connect through this proxy.
        envFile: false, define: { 'import.meta.env.VITE_SOCKET_URL': JSON.stringify('') },
        server: { host: '127.0.0.1', port: 0, strictPort: true,
          proxy: { '/socket.io': { target, ws: true } } }, logLevel: 'error' });
      await vite.listen();
      const url = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
      allowedOrigins.push(url);
      await provide(url);
    } finally {
      // Close sockets before Vite so upgraded proxy connections cannot hold teardown open.
      await new Promise<void>(resolve => server.io.close(() => resolve()));
      await vite?.close();
    }
  },
  peers: async ({ browser, viewport, isMobile, hasTouch }, provide) => {
    const peers: Peer[] = [];
    // The createRoom fixture fills this test-local collection.
    void browser; void viewport; void isMobile; void hasTouch;
    try { await provide(peers); }
    finally { await Promise.all(peers.map(peer => peer.context.close())); }
  },
  openPeer: async ({ browser, viewport, isMobile, hasTouch, site, peers }, provide) => {
    await provide(async (url = site) => {
      const context = await browser.newContext({ viewport, isMobile, hasTouch });
      const page = await context.newPage();
      const peer: Peer = { page, context, view: null }; peers.push(peer); observe(peer);
      await page.goto(url);
      return peer;
    });
  },
  createRoom: async ({ openPeer, peers, scenario }, provide) => {
    await provide(async (mode, { start = true, beginnerHelpEnabled = false } = {}) => {
      for (let seat = 0; seat < GAME_RULES[mode].playerCount; seat++) {
        const peer = await openPeer(), page = peer.page;
        await page.locator('.online-mode-entry').click();
        await expect(page.getByLabel('닉네임', { exact: true })).toBeEnabled();
        await page.getByLabel('닉네임', { exact: true }).fill(scenario === 'history' ? `ABCDEFGHIJK${seat}` : `친구${seat}`);
        if (!seat) {
          await page.getByLabel('게임 모드', { exact: true }).selectOption(mode);
          if (beginnerHelpEnabled) await page.getByLabel('초보자 도움말 사용 가능', { exact: true }).check();
          await page.getByRole('button', { name: '방 만들기', exact: true }).click();
        } else {
          await page.getByLabel('방 코드', { exact: true }).fill(peers[0].view!.code);
          await page.getByRole('button', { name: '참가하기', exact: true }).click();
        }
        await expect(page.locator('.online-waiting-room')).toBeVisible();
        await expect.poll(() => !!peer.view).toBe(true);
        await noOverflow(page);
      }
      if (!start) return peers;
      await startRoom(peers);
      for (const peer of peers) {
        await expect(peer.page.getByTestId('online-board')).toBeVisible();
        await expect.poll(() => !!peer.view?.game).toBe(true);
      }
      return peers;
    });
  },
});
export { expect };

export async function startRoom(peers: Peer[]) {
  for (const peer of peers) {
    if (!peer.view!.connections[peer.view!.you].ready) await peer.page.getByRole('button', { name: '준비', exact: true }).click();
  }
  await peers[0].page.getByRole('button', { name: '게임 시작', exact: true }).click();
  for (const peer of peers) await expect(peer.page.getByTestId('online-board')).toBeVisible();
}

export async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const selectors = '.online-page, .online-game-toolbar, .online-game-logs, .online-game-log-panel, .online-reconnect-notice, .online-player-connection, .player-area, .table, .go-stop-modal, .game-over-modal, .capture-zoom-panel, .online-settlement-detail';
    return document.documentElement.scrollWidth <= innerWidth + 1 &&
      [...document.querySelectorAll(selectors)].filter(e => e.getClientRects().length).every(e => {
        const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1;
      });
  })).toBe(true);
}

export async function settled(peer: Peer) {
  await expect(peer.page.getByTestId('online-board')).not.toHaveClass(/is-animating/);
  await expect(peer.page.getByRole('button', { name: '새로고침', exact: true })).toBeEnabled();
}

export async function playTurn(peers: Peer[]) {
  const seat = peers[0].view!.game!.turn;
  for (let step = 0; step < 4; step++) {
    const peer = peers[seat]; await settled(peer);
    const game = peer.view!.game!;
    if (game.turn !== seat) return;
    if (game.phase === 'choose') await peer.page.locator('.floor-cards button.selectable').first().click();
    else if (game.phase === 'go-stop') await peer.page.getByRole('button', { name: 'GO', exact: true }).click();
    else {
      await peer.page.getByTestId('own-hand').locator('button.card').first().click();
      // Wait for either a server revision or the existing special-choice dialog.
      await expect.poll(async () => peer.view!.game!.revision > game.revision ||
        await peer.page.getByRole('dialog', { name: '특수 행동 선택' }).isVisible()).toBe(true);
      if (peer.view!.game!.revision === game.revision) {
        await peer.page.getByRole('button', { name: '그냥 한 장 내기', exact: true }).click();
      }
    }
    await expect.poll(() => peers.filter(p => peer.view!.connections[p.view!.you].connected)
      .every(p => p.view!.game!.revision > game.revision)).toBe(true);
    if (peers[0].view!.game!.turn !== seat) return;
  }
  throw new Error('Turn did not advance after resolving its decisions');
}
