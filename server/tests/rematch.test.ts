import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { io, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createOnlineServer, RECONNECT_GRACE_MS } from '../app';
import { createMatch, type Match } from '../game';
import { hwatuCards } from '../../src/data/cards';
import { GAME_RULES, type GameMode } from '../../src/game/rules';
import type { ClientEvents, GameAction, ReconnectSession, RematchRequest, RoomView, ServerEvents } from '../../shared/online';

type Peer = { socket: Socket<ServerEvents, ClientEvents>; view: RoomView | null; session: ReconnectSession | null; closed: string | null };
async function until(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) { if (Date.now() > end) throw new Error('Rematch state timeout'); await delay(5); }
}
async function harness(t: TestContext, options: Parameters<typeof createOnlineServer>[0] = {}) {
  const server = createOnlineServer(options);
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
  const peers: Peer[] = [];
  t.after(async () => { peers.forEach(p => p.socket.disconnect()); await new Promise<void>(resolve => server.io.close(() => resolve())); });
  const connect = async () => {
    const socket: Peer['socket'] = io(`http://127.0.0.1:${(server.http.address() as AddressInfo).port}`, { forceNew: true, reconnection: false, transports: ['websocket'] });
    const peer: Peer = { socket, view: null, session: null, closed: null }; peers.push(peer);
    socket.on('room:state', view => { peer.view = view; }); socket.on('room:session', session => { peer.session = session; }); socket.on('room:closed', reason => { peer.closed = reason; });
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return peer;
  };
  const room = async (mode: GameMode) => {
    const host = await connect(); assert.equal((await host.socket.emitWithAck('room:create-mode', mode, 'Host')).ok, true);
    const players = [host];
    for (let i = 1; i < GAME_RULES[mode].playerCount; i++) {
      const p = await connect(); assert.equal((await p.socket.emitWithAck('room:join', host.view!.code, `Guest${i}`)).ok, true); players.push(p);
    }
    for (const p of players) await p.socket.emitWithAck('room:ready', true);
    await host.socket.emitWithAck('room:start'); await until(() => players.every(p => !!p.view?.game)); return players;
  };
  return { connect, room };
}
function rematch(p: Peer, ready = true): RematchRequest { return { roomCode: p.view!.code, round: p.view!.round, ready }; }
function action(p: Peer, type: GameAction['type'], cardId?: string): GameAction { return { roomCode: p.view!.code, revision: p.view!.game!.revision, type, ...(cardId ? { cardId } : {}) }; }
async function finish(players: Peer[]) {
  for (let n = 0; n < 150 && players[0].view!.game!.phase !== 'finished'; n++) {
    const p = players[players[0].view!.game!.turn], g = p.view!.game!;
    const move = g.phase === 'choose' ? action(p, 'choose', g.choice![0].id) : g.phase === 'go-stop' ? action(p, 'stop')
      : g.players[g.turn].bombPassCount ? action(p, 'bomb-pass') : action(p, 'play', g.hand[0].id);
    assert.equal((await p.socket.emitWithAck('game:action', move)).ok, true);
    await until(() => players.every(p => p.view!.game!.revision > g.revision));
  }
  assert.equal(players[0].view!.game!.phase, 'finished');
}
function assertFresh(players: Peer[]) {
  const first = players[0].view!, rule = GAME_RULES[first.mode];
  assert.equal(first.game!.phase, 'play'); assert.equal(first.game!.turn, 0);
  assert.equal(first.game!.floor.length, rule.floorSize); assert.equal(first.game!.drawCount, 48 - rule.handSize * rule.playerCount - rule.floorSize);
  assert.equal(first.game!.result, null); assert.equal(first.game!.choice, null);
  assert.deepEqual(first.game!.revealed, []); assert.deepEqual(first.game!.specialEvents, []); assert.deepEqual(first.game!.ppeokStacks, []);
  for (const p of players) {
    assert.equal(p.view!.game!.hand.length, rule.handSize);
    assert.ok(p.view!.connections.every(c => !c.rematchReady));
    for (const player of p.view!.game!.players) {
      assert.deepEqual(player.captured, []); assert.equal(player.score, 0); assert.equal(player.goCount, 0);
      assert.equal(player.bombCount, 0); assert.equal(player.bombPassCount, 0); assert.deepEqual(player.shakeMonths, []); assert.ok(!('hand' in player));
    }
    const wire = JSON.stringify(p.view);
    assert.ok(!('pile' in p.view!.game!) && !('pending' in p.view!.game!));
    for (const other of players.filter(other => other !== p)) {
      for (const card of other.view!.game!.hand) assert.ok(!wire.includes(`"${card.id}"`));
      assert.ok(!wire.includes(other.session!.token));
    }
  }
  const cards = [...players.flatMap(p => p.view!.game!.hand), ...first.game!.floor];
  assert.equal(new Set(cards.map(card => card.id)).size, cards.length);
}

for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: unanimous rematch reuses room, members, tokens and resets every match field`, async t => {
    const matches: Match[] = [];
    const h = await harness(t, { matchFactory: mode => {
      const m = createMatch(mode); matches.push(m);
      if (matches.length === 1) {
        m.phase = 'go-stop'; m.turn = 1; m.floor = hwatuCards.slice(0, 3); m.pile = [];
        m.revealed = hwatuCards.slice(0, 2); m.events = ['bomb', 'shake']; m.ppeokStacks = [{ month: 1, owner: 1 }];
        m.pending = { kind: 'hand', card: hwatuCards[3], matches: m.floor.slice(0, 2) };
        m.players.forEach(p => { p.hand = [hwatuCards[4]]; p.captured = hwatuCards.slice(8, 28); p.goCount = 3; p.lastGoScore = 17; p.bombCount = 2; p.bombPassCount = 2; p.shakeMonths = [1, 2]; });
      }
      return m;
    } });
    const players = await h.room(mode), identities = players.map(p => ({ code: p.view!.code, you: p.view!.you, host: p.view!.host, connections: p.view!.connections.map(c => [c.seat, c.nickname, c.ready]), token: p.session!.token, socketId: p.socket.id }));
    assert.equal((await players[1].socket.emitWithAck('game:action', action(players[1], 'stop'))).ok, true);
    await until(() => players.every(p => p.view!.game!.phase === 'finished'));
    assert.ok(players[0].view!.game!.result?.settlement || players[0].view!.game!.result?.gostopSettlement);
    const old = structuredClone(players[0].view!.game), oldMove = action(players[0], 'play', hwatuCards[4].id);
    const request = rematch(players[0]);
    for (const reply of await Promise.all([players[0].socket.emitWithAck('game:rematch', request), players[0].socket.emitWithAck('game:rematch', request)])) assert.equal(reply.ok, true);
    assert.equal(matches.length, 1); assert.equal(players[0].view!.round, 1);
    assert.equal((await players[0].socket.emitWithAck('game:rematch', rematch(players[0], false))).ok, true);
    await until(() => players.every(p => !p.view!.connections[0].rematchReady));
    for (const p of players.slice(0, -1)) assert.equal((await p.socket.emitWithAck('game:rematch', rematch(p))).ok, true);
    assert.equal(matches.length, 1); assert.equal(players[0].view!.game!.phase, 'finished');
    const last = players.at(-1)!, lastRequest = rematch(last);
    const replies = await Promise.all([last.socket.emitWithAck('game:rematch', lastRequest), last.socket.emitWithAck('game:rematch', lastRequest)]);
    assert.equal(replies.filter(r => r.ok).length, 1);
    await until(() => players.every(p => p.view!.round === 2)); assert.equal(matches.length, 2); assertFresh(players);
    assert.equal(matches[1].pending, null); assert.ok(matches[1].players.every(p => p.lastGoScore === 0));
    assert.notDeepEqual(players[0].view!.game!.hand, old!.hand); assert.notDeepEqual(players[0].view!.game!.floor, old!.floor);
    assert.ok(players[0].view!.game!.revision > old!.revision);
    players.forEach((p, i) => assert.deepEqual({ code: p.view!.code, you: p.view!.you, host: p.view!.host, connections: p.view!.connections.map(c => [c.seat, c.nickname, c.ready]), token: p.session!.token, socketId: p.socket.id }, identities[i]));
    assert.equal((await players[0].socket.emitWithAck('game:action', oldMove)).ok, false);
    assert.equal((await players[0].socket.emitWithAck('game:rematch', request)).ok, false);
    await finish(players);
    assert.equal((await players[0].socket.emitWithAck('game:rematch', request)).ok, false, 'previous-round rematch cannot vote in later finished round');
    for (const p of players) assert.equal((await p.socket.emitWithAck('game:rematch', rematch(p))).ok, true);
    await until(() => players.every(p => p.view!.round === 3)); assertFresh(players);
  });
  test(`${mode}: real full round and rematch reject early, malformed and foreign requests`, async t => {
    const h = await harness(t), players = await h.room(mode), foreign = await h.connect();
    assert.equal((await players[0].socket.emitWithAck('game:rematch', rematch(players[0]))).ok, false);
    await finish(players); const before = structuredClone(players[0].view);
    for (const invalid of [null, [], {}, { ...rematch(players[0]), ready: 'true' }, { ...rematch(players[0]), seat: 1 }, { ...rematch(players[0]), round: 0 }, { ...rematch(players[0]), round: 1.5 }, { ...rematch(players[0]), roomCode: 'ZZZZZZ' }]) {
      assert.equal((await players[0].socket.emitWithAck('game:rematch', invalid as RematchRequest)).ok, false);
    }
    assert.equal((await foreign.socket.emitWithAck('game:rematch', rematch(players[0]))).ok, false);
    assert.deepEqual(players[0].view, before);
    for (const p of players) await p.socket.emitWithAck('game:rematch', rematch(p));
    await until(() => players.every(p => p.view!.round === 2)); assertFresh(players);
    const g = players[0].view!.game!;
    assert.equal((await players[0].socket.emitWithAck('game:action', action(players[0], 'play', g.hand[0].id))).ok, true);
    await until(() => players.every(p => p.view!.game!.revision > g.revision));
  });
  test(`${mode}: consent survives F5-equivalent resume and offline unanimity waits for connection`, async t => {
    assert.equal(RECONNECT_GRACE_MS, 60000);
    const h = await harness(t), players = await h.room(mode); await finish(players);
    const original = players[0], credentials = original.session!;
    await original.socket.emitWithAck('game:rematch', rematch(original));
    original.socket.disconnect(); await until(() => !players[1].view!.connections[0].connected);
    for (const p of players.slice(1)) await p.socket.emitWithAck('game:rematch', rematch(p));
    assert.equal(players[1].view!.game!.phase, 'finished'); assert.equal(players[1].view!.round, 1);
    const fresh = await h.connect(); assert.equal((await fresh.socket.emitWithAck('room:resume', credentials)).ok, true); players[0] = fresh;
    await until(() => players.every(p => p.view!.round === 2)); assertFresh(players); assert.deepEqual(fresh.session, credentials); assert.equal(fresh.view!.you, 0);
  });
  test(`${mode}: partial consent remains after refreshed socket resumes`, async t => {
    const h = await harness(t), players = await h.room(mode); await finish(players);
    const original = players[0], credentials = original.session!; await original.socket.emitWithAck('game:rematch', rematch(original));
    original.socket.disconnect(); await until(() => !players[1].view!.connections[0].connected);
    const fresh = await h.connect(); assert.equal((await fresh.socket.emitWithAck('room:resume', credentials)).ok, true);
    assert.equal(fresh.view!.game!.phase, 'finished'); assert.equal(fresh.view!.connections[0].rematchReady, true); assert.equal(fresh.view!.round, 1); assert.deepEqual(fresh.session, credentials);
    await fresh.socket.emitWithAck('game:rematch', rematch(fresh, false)); await until(() => !players[1].view!.connections[0].rematchReady);
  });
  for (const expiry of [false, true]) test(`${mode}: finished rematch room closes on ${expiry ? 'grace expiry' : 'explicit leave'}`, async t => {
    const h = await harness(t, { reconnectGraceMs: 350 }), players = await h.room(mode); await finish(players);
    const credentials = players[0].session!; await players[0].socket.emitWithAck('game:rematch', rematch(players[0]));
    if (expiry) players[0].socket.disconnect(); else assert.equal((await players[0].socket.emitWithAck('room:leave')).ok, true);
    await until(() => players.slice(1).every(p => !!p.closed));
    const fresh = await h.connect(); assert.equal((await fresh.socket.emitWithAck('room:resume', credentials)).ok, false);
  });
}
