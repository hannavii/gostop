import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameLogEntry, GameLogEvent, RoomView } from '../shared/online';
import { gameLogText } from '../src/online/gameLogText';
import GameLogPanel from '../src/online/GameLogPanel';
import { acceptRoomState } from '../src/online/roomState';

const entry = (event: GameLogEvent, sequence = 1): GameLogEntry => ({ ...event, id: `ABC123:1:${sequence}`, round: 1, revision: 0, sequence });
test('log formatter uses only server payloads and clearly labels automatic actions', () => {
  const name = () => '친구';
  assert.match(gameLogText(entry({ type: 'start', payload: { rematch: false } }), name), /게임을 시작/);
  assert.match(gameLogText(entry({ type: 'start', payload: { rematch: true } }), name), /재대결/);
  for (const type of ['play', 'choose', 'bomb', 'shake'] as const) {
    const text = gameLogText(entry({ type, playerSeat: 0, payload: { month: 3, category: 'pi', automatic: true } }), name);
    assert.match(text, /3월/); assert.match(text, /시간 초과 · 자동 행동/);
  }
  assert.match(gameLogText(entry({ type: 'go', playerSeat: 0, payload: { goCount: 2, automatic: false } }), name), /2고/);
  assert.match(gameLogText(entry({ type: 'stop', playerSeat: 0, payload: { automatic: true } }), name), /STOP.*시간 초과/);
  assert.match(gameLogText(entry({ type: 'special', playerSeat: 0, payload: { event: 'ppeok' } }), name), /뻑/);
  assert.match(gameLogText(entry({ type: 'finished', payload: { winner: 0 } }), name), /친구님 승리/);
  assert.match(gameLogText(entry({ type: 'finished', payload: { winner: 'draw' } }), name), /무승부/);
  assert.match(gameLogText(entry({ type: 'disconnect', playerSeat: 0, payload: {} }), name), /연결이 끊겼/);
  assert.match(gameLogText(entry({ type: 'reconnect', playerSeat: 0, payload: {} }), name), /다시 연결/);
});

test('panel is collapsed, accessible and has no aggressive live announcements', () => {
  const html = renderToStaticMarkup(createElement(GameLogPanel, { entries: [entry({ type: 'start', payload: { rematch: false } })], name: () => '<친구>' }));
  assert.match(html, /aria-expanded="false"/); assert.match(html, /최근 행동 1/);
  assert.ok(!html.includes('<ol>') && !html.includes('aria-live'));
});

test('older same-revision connection log snapshots cannot overwrite newer sequences', () => {
  const room: RoomView = { code: 'ABC123', round: 1, mode: 'matgo', capacity: 2, occupancy: 0, host: 0, you: 0,
    connections: [], game: null, logs: [entry({ type: 'start', payload: { rematch: false } }, 1)] };
  const newer = { ...room, logs: [...room.logs!, entry({ type: 'disconnect', playerSeat: 0, payload: {} }, 2)] };
  assert.equal(acceptRoomState(newer, room), newer);
  assert.equal(acceptRoomState(newer, { ...room, round: 2 }).round, 2);
});
