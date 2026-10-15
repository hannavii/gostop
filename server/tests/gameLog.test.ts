import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { GameLog, MAX_GAME_LOG_ENTRIES } from '../gameLog';
import { applyAction, createMatch, type Match } from '../game';
import { createOnlineServer } from '../app';
import type { ClientEvents, GameAction, ReconnectSession, RoomView, ServerEvents } from '../../shared/online';
import type { HwatuCard } from '../../src/types/game';

const card = (month: number, cardIndex: number): HwatuCard => ({ id: `${month}-${cardIndex}`, month, cardIndex, category: 'pi', tags: [] });
function move(log: GameLog, before: Match, type: GameAction['type'], cardId?: string, automatic = false) {
  const action = { roomCode: 'ABC123', revision: before.revision, type, ...(cardId ? { cardId } : {}) };
  const after = applyAction(before, before.turn, action);
  log.action(before, after, before.turn, action, automatic);
  return after;
}

test('log is bounded, ordered, round-scoped and supports several entries at one revision', () => {
  const log = new GameLog('ABC123'); log.start(1, 0);
  for (let index = 0; index < MAX_GAME_LOG_ENTRIES + 50; index++) log.append(1, { type: 'disconnect', playerSeat: 0, payload: {} });
  assert.equal(log.entries.length, MAX_GAME_LOG_ENTRIES);
  assert.equal(new Set(log.entries.map(entry => entry.id)).size, log.entries.length);
  assert.ok(log.entries.every((entry, i, all) => !i || entry.sequence > all[i - 1].sequence));
  const ids = new Set(log.entries.map(entry => entry.id)); log.start(2, 10);
  assert.equal(log.entries.length, 1); assert.equal(log.entries[0].round, 2);
  assert.ok(!ids.has(log.entries[0].id));
  assert.deepEqual(log.entries[0].payload, { rematch: true });
});

for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: committed card choices, bomb, shake, passes, GO and automatic STOP log once`, () => {
    const log = new GameLog('ABC123'); log.start(1, 0);
    let match = createMatch(mode);
    match.players[0].hand = [card(1, 3), card(3, 1)];
    match.floor = [card(1, 1), card(1, 2)]; match.pile = [card(1, 4), card(4, 1)];
    match = move(log, match, 'play', '1-3');
    assert.equal(match.phase, 'choose'); assert.equal(log.entries.at(-1)!.type, 'play');
    match = move(log, match, 'choose', '1-1', true);
    assert.equal(log.entries.filter(entry => entry.type === 'choose').length, 1);
    for (const event of ['ttadak', 'pansseul']) assert.equal(log.entries.filter(e => e.type === 'special' && e.payload.event === event).length, 1);
    match.phase = 'go-stop'; match.turn = 0;
    match = move(log, match, 'go'); assert.equal(log.entries.at(-1)!.type, 'go');
    match.phase = 'go-stop'; match.turn = 0;
    move(log, match, 'stop', undefined, true);
    assert.deepEqual(log.entries.slice(-2).map(e => e.type), ['stop', 'finished']);
    const stop = log.entries.at(-2)!; assert.ok('automatic' in stop.payload && stop.payload.automatic);
    for (const type of ['bomb', 'shake'] as const) {
      const special = createMatch(mode);
      special.players[0].hand = [card(1, 1), card(1, 2), card(1, 3)];
      special.floor = type === 'bomb' ? [card(1, 4)] : [];
      special.pile = [card(1, 4), card(2, 1)];
      if (type === 'bomb') special.pile = [card(2, 1), card(2, 2)];
      const after = move(log, special, type, '1-1');
      assert.equal(log.entries.filter(e => e.type === type).length, 1);
      assert.ok(!log.entries.some(e => e.type === 'special' && e.payload.event === type));
      if (type === 'bomb') { after.turn = 0; after.phase = 'play'; move(log, after, 'bomb-pass'); }
    }
    assert.equal(log.entries.filter(e => e.type === 'bomb-pass').length, 1);
    const serialized = JSON.stringify(log.entries);
    for (const key of ['cardId', 'hand', 'pile', 'pending', 'token', 'socketId', 'generation']) assert.ok(!serialized.includes(`"${key}"`));
  });

  test(`${mode}: real engine ppeok, jjok and ppeok capture events are projected without guessing`, () => {
    for (const event of ['ppeok', 'jjok', 'ppeok-capture', 'self-ppeok-capture'] as const) {
      const log = new GameLog('ABC123'); log.start(1, 0);
      const match = createMatch(mode);
      match.players[0].hand = [card(1, 1), card(5, 1)]; match.pile = [card(1, 4), card(6, 1)];
      match.floor = event === 'ppeok' ? [card(1, 2)] : event === 'jjok' ? [] : [card(1, 2), card(1, 3), card(1, 4)];
      if (event.includes('capture')) {
        match.ppeokStacks = [{ month: 1, owner: event === 'self-ppeok-capture' ? 0 : 1 }];
        match.pile = [card(2, 1), card(6, 1)];
      }
      const after = move(log, match, 'play', '1-1');
      assert.ok(after.events.includes(event));
      assert.equal(log.entries.filter(e => e.type === 'special' && e.payload.event === event).length, 1);
    }
  });

  test(`${mode}: Socket snapshots synchronize logs, reject forged/replayed actions and recover without duplicate entries`, async t => {
    const server = createOnlineServer(); server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
    type Peer = { socket: Socket<ServerEvents, ClientEvents>; view: RoomView | null; session: ReconnectSession | null };
    const peers: Peer[] = [];
    t.after(async () => { peers.forEach(p => p.socket.disconnect()); await new Promise<void>(resolve => server.io.close(() => resolve())); });
    async function until(check: () => boolean) {
      const deadline = Date.now() + 4000;
      while (!check()) { if (Date.now() > deadline) throw new Error('Log snapshot timeout'); await delay(5); }
    }
    async function connect() {
      const socket: Peer['socket'] = io(`http://127.0.0.1:${(server.http.address() as AddressInfo).port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
      const peer: Peer = { socket, view: null, session: null }; peers.push(peer);
      socket.on('room:state', view => { peer.view = view; }); socket.on('room:session', session => { peer.session = session; });
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return peer;
    }
    const host = await connect(); await host.socket.emitWithAck('room:create-mode', mode, 'Host');
    const players = [host];
    for (let index = 1; index < (mode === 'matgo' ? 2 : 3); index++) {
      const peer = await connect(); await peer.socket.emitWithAck('room:join', host.view!.code, `Guest${index}`); players.push(peer);
    }
    for (const peer of players) await peer.socket.emitWithAck('room:ready', true);
    await host.socket.emitWithAck('room:start'); await until(() => players.every(p => !!p.view!.game));
    assert.deepEqual(host.view!.logs!.map(e => e.type), ['start']);
    const before = JSON.stringify(host.view!.logs);
    for (const invalid of [{ type: 'log' }, { type: 'play', automatic: true }, { type: 'stop', payload: {} }]) {
      assert.equal((await host.socket.emitWithAck('game:action', { roomCode: host.view!.code, revision: 0, ...invalid } as GameAction)).ok, false);
    }
    await host.socket.emitWithAck('room:sync'); assert.equal(JSON.stringify(host.view!.logs), before);
    const action: GameAction = { roomCode: host.view!.code, revision: 0, type: 'play', cardId: host.view!.game!.hand[0].id };
    const replies = await Promise.all([host.socket.emitWithAck('game:action', action), host.socket.emitWithAck('game:action', action)]);
    assert.equal(replies.filter(r => r.ok).length, 1);
    await until(() => players.every(p => p.view!.game!.revision === 1));
    assert.equal(host.view!.logs!.filter(e => e.type === 'play').length, 1);
    for (const peer of players) assert.deepEqual(peer.view!.logs, host.view!.logs);
    const saved = host.view!.logs!.map(e => e.id);
    const session = players[1].session!; players[1].socket.disconnect();
    await until(() => host.view!.logs!.at(-1)?.type === 'disconnect');
    const resumed = await connect(); await resumed.socket.emitWithAck('room:resume', session);
    await until(() => host.view!.logs!.at(-1)?.type === 'reconnect');
    assert.deepEqual(resumed.view!.logs, host.view!.logs);
    assert.deepEqual(host.view!.logs!.slice(0, saved.length).map(e => e.id), saved);
    const length = host.view!.logs!.length;
    await resumed.socket.emitWithAck('room:resume', session); await resumed.socket.emitWithAck('room:sync');
    assert.equal(resumed.view!.logs!.length, length);
    for (const peer of [host, resumed, ...players.slice(2)]) {
      const wire = JSON.stringify(peer.view);
      for (const other of peers) if (other.session) assert.ok(!wire.includes(other.session.token));
      assert.equal(new Set(peer.view!.logs!.map(e => e.id)).size, length);
      for (const other of players.filter(p => p.view!.you !== peer.view!.you)) {
        for (const card of other.view!.game!.hand) assert.ok(!wire.includes(`"${card.id}"`));
      }
    }
  });
}
