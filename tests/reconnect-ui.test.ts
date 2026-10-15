import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConnectionStatus, { ReconnectNotice } from '../src/online/ConnectionStatus';
import { reconnectSeconds } from '../src/online/reconnectCountdown';
import { createMatch, gameView } from '../server/game';
import OnlineGameBoard from '../src/online/OnlineGameBoard';
import type { RoomView } from '../shared/online';

test('reconnect countdown uses ceiling and clamps at zero', () => {
  assert.equal(reconnectSeconds(60_000, 0), 60);
  assert.equal(reconnectSeconds(60_000, 1000), 59);
  assert.equal(reconnectSeconds(60_000, 59_999), 1);
  assert.equal(reconnectSeconds(60_000, 61_000), 0);
});

test('connection labels are textual, escaped and show no invented local deadline', () => {
  const player = { seat: 0 as const, nickname: '<친구>', ready: true, rematchReady: false, connected: false, reconnectDeadline: null };
  const unknown = renderToStaticMarkup(createElement(ConnectionStatus, { player }));
  assert.match(unknown, /재접속 대기 중/); assert.match(unknown, /서버 확인 중/);
  assert.ok(!unknown.includes('reconnect-countdown'));
  const known = renderToStaticMarkup(createElement(ConnectionStatus, { player: { ...player, reconnectDeadline: 1 } }));
  assert.match(known, /0초 남음/);
  const notice = renderToStaticMarkup(createElement(ReconnectNotice, { connections: [player], activeSeat: 0 }));
  assert.match(notice, /&lt;친구&gt;님의 재접속을 기다리는 중입니다/);
  const restored = { ...player, connected: true, reconnectDeadline: null };
  assert.equal(renderToStaticMarkup(createElement(ReconnectNotice, { connections: [restored] })), '');
  assert.match(renderToStaticMarkup(createElement(ConnectionStatus, { player: restored })), /접속 중/);
});

test('active disconnect disables hand, floor and decision controls; non-active disconnect preserves input and rematch', () => {
  for (const mode of ['matgo', 'gostop'] as const) {
    const match = createMatch(mode);
    const room: RoomView = { code: 'ABC123', round: 1, mode, host: 0, capacity: match.players.length,
      occupancy: match.players.length, you: 0, game: gameView(match, 0),
      connections: match.players.map((_, seat) => ({ seat: seat as 0 | 1 | 2, nickname: `친구${seat}`,
        ready: true, rematchReady: false, connected: seat !== 0, reconnectDeadline: seat === 0 ? 1 : null })) };
    const board = () => renderToStaticMarkup(createElement(OnlineGameBoard, { room, game: gameView(match, 0), enabled: true,
      message: '', act() {}, onRematch() {}, onLeave() {}, onSync() {} }));
    assert.ok(!board().match(/<button[^>]*class="card/));
    assert.match(board(), /친구0님의 재접속을 기다리는 중입니다/);
    match.phase = 'go-stop';
    assert.match(board(), /class="go-button" disabled=""/);
    assert.match(board(), /class="stop-button" disabled=""/);
    room.connections[0].connected = true; room.connections[0].reconnectDeadline = null;
    room.connections[1].connected = false; room.connections[1].reconnectDeadline = 1;
    match.phase = 'play'; assert.match(board(), /<button[^>]*class="card/);
    match.phase = 'finished'; match.result = { winner: 'draw', settlement: null };
    room.connections[0].connected = false;
    assert.match(board(), /class="rematch-button">/);
  }
});
