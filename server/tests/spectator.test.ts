import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { createOnlineServer, MAX_SPECTATORS_PER_ROOM } from '../app';
import { createMatch, spectatorGameView, type Match } from '../game';
import type { ClientEvents, ServerEvents, RoomView, SpectatorRoomView, ReconnectSession } from '../../shared/online';

for (const mode of ['matgo', 'gostop'] as const) test(`${mode}: spectator privacy, lifecycle, forged actions, tokens and rematch`, async t => {
  let match!: Match;
  const server = createOnlineServer({ matchFactory: m => (match = createMatch(m)) });
  const clients: Socket<ServerEvents, ClientEvents>[] = [];
  const views: RoomView[] = [];
  let watched!: SpectatorRoomView;
  let session!: ReconnectSession;
  const playerSessions: ReconnectSession[] = [];
  t.after(async () => { clients.forEach(c => c.disconnect()); await new Promise<void>(r => server.io.close(() => r())); });
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
  const url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  async function connect() {
    const c: Socket<ServerEvents, ClientEvents> = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(c); await new Promise<void>((resolve, reject) => { c.once('connect', resolve); c.once('connect_error', reject); }); return c;
  }
  const count = mode === 'matgo' ? 2 : 3;
  for (let i = 0; i < count; i++) {
    const c = await connect(); c.on('room:state', v => { views[i] = v; });
    c.on('room:session', v => { playerSessions[i] = v; });
    assert.equal((i ? await c.emitWithAck('room:join', views[0].code, `p${i}`)
      : await c.emitWithAck('room:create-options', { mode, nickname: 'host', visibility: 'public' })).ok, true);
    await c.emitWithAck('room:ready', true);
  }
  const code = views[0].code;
  const spectator = await connect();
  spectator.on('room:spectator-state', v => { watched = v; });
  spectator.on('room:session', v => { session = v; });
  assert.equal((await spectator.emitWithAck('room:spectate', { roomCode: code })).ok, false);
  await clients[0].emitWithAck('room:start');
  const before = JSON.stringify(views[0]);
  assert.equal((await spectator.emitWithAck('room:spectate', { roomCode: code })).ok, true);
  const foreignHost = await connect();
  let foreignCode = '';
  foreignHost.on('room:state', v => { foreignCode = v.code; });
  await foreignHost.emitWithAck('room:create', 'Private host');
  const outsider = await connect();
  let listed: string[] = [];
  outsider.on('room:list', list => { listed = list.map(r => r.roomCode); });
  await outsider.emitWithAck('room:list');
  assert.ok(!listed.includes(code) && !listed.includes(foreignCode));
  assert.equal((await outsider.emitWithAck('room:spectator-resume', { roomCode: foreignCode, token: session.token })).ok, false);
  assert.equal(JSON.stringify(views[0]), before);
  assert.equal(watched.you, null); assert.equal(watched.capacity, count); assert.equal(watched.occupancy, count);
  function privacy() {
    const wire = JSON.stringify(watched);
    for (const card of [...match.players.flatMap(p => p.hand), ...match.pile]) assert.ok(!wire.includes(`"id":"${card.id}"`));
    for (const key of ['token', 'tokenHash', 'socketId', 'pending', 'generation', 'pile', 'deadline', 'timer', 'privateServerObject']) {
      assert.ok(!wire.includes(`"${key}":`));
    }
    for (const s of [session, ...playerSessions]) assert.ok(!wire.includes(s.token));
    for (const c of clients) if (c.id) assert.ok(!wire.includes(c.id));
    assert.deepEqual(watched.game!.hand, []); assert.deepEqual(watched.game!.specialOptions, []);
    assert.equal(watched.game!.choice, null); assert.equal(watched.game!.canPlayHand, false);
    assert.deepEqual(watched.game!.floor, views[0].game!.floor);
    assert.deepEqual(watched.game!.players, views[0].game!.players);
    assert.equal(views[0].game!.hand.length, match.players[0].hand.length);
  }
  privacy();
  for (const type of ['play', 'choose', 'go', 'stop', 'bomb', 'shake', 'bomb-pass'] as const) {
    assert.equal((await spectator.emitWithAck('game:action', { roomCode: code, revision: match.revision, type, cardId: match.players[0].hand[0].id })).ok, false);
  }
  assert.equal((await spectator.emitWithAck('room:ready', true)).ok, false);
  assert.equal((await spectator.emitWithAck('room:start')).ok, false);
  assert.equal((await spectator.emitWithAck('game:rematch', { roomCode: code, round: 1, ready: true })).ok, false);
  assert.equal((await spectator.emitWithAck('room:resume', playerSessions[0])).ok, false);
  const replacement = await connect();
  replacement.on('room:spectator-state', v => { watched = v; });
  assert.equal((await replacement.emitWithAck('room:resume', { roomCode: code, token: session.token })).ok, false);
  assert.equal((await replacement.emitWithAck('room:spectator-resume', playerSessions[0])).ok, false);
  assert.equal((await replacement.emitWithAck('room:spectator-resume', { roomCode: code, token: session.token })).ok, true);
  privacy();
  assert.equal(JSON.stringify(views[0]), before);
  replacement.disconnect();
  const refreshed = await connect(); refreshed.on('room:spectator-state', v => { watched = v; });
  assert.equal((await refreshed.emitWithAck('room:spectator-resume', { roomCode: code, token: session.token })).ok, true);
  privacy();
  assert.equal(JSON.stringify(views[0]), before);
  // Force only the test-owned factory match to its terminal phase, then use real rematch votes.
  match.phase = 'finished'; match.pending = null;
  for (let i = 0; i < count; i++) assert.equal((await clients[i].emitWithAck('game:rematch', { roomCode: code, round: 1, ready: true })).ok, true);
  await refreshed.emitWithAck('room:sync');
  assert.equal(watched.round, 2); privacy();
  for (let i = 1; i < MAX_SPECTATORS_PER_ROOM; i++) {
    const extra = await connect();
    assert.equal((await extra.emitWithAck('room:spectate', { roomCode: code })).ok, true);
  }
  assert.equal((await outsider.emitWithAck('room:spectate', { roomCode: code })).ok, false);
  const deadline = watched.turnTimer?.turnDeadline;
  assert.equal((await refreshed.emitWithAck('room:leave')).ok, true);
  await clients[0].emitWithAck('room:sync');
  assert.equal(views[0].turnTimer?.turnDeadline, deadline);
  assert.equal(MAX_SPECTATORS_PER_ROOM, 20);
});

test('spectator projection explicitly hides private choices in every decision phase', () => {
  const m = createMatch();
  m.pending = { kind: 'hand', card: m.players[0].hand[0], matches: m.floor.slice(0, 2) };
  Object.assign(m, { privateServerObject: 'private-server-sentinel' });
  for (const phase of ['play', 'choose', 'go-stop', 'finished'] as const) {
    m.phase = phase;
    const v = spectatorGameView(m);
    assert.deepEqual(v.hand, []); assert.deepEqual(v.specialOptions, []); assert.equal(v.choice, null);
    assert.ok(!JSON.stringify(v).includes('private-server-sentinel'));
  }
});

test('private matches support code spectating; expired spectator sessions free capacity without affecting players', async t => {
  const server = createOnlineServer({ reconnectGraceMs: 50 });
  const clients: Socket<ServerEvents, ClientEvents>[] = [];
  t.after(async () => { clients.forEach(c => c.disconnect()); await new Promise<void>(r => server.io.close(() => r())); });
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
  const url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  async function connect() {
    const c: Socket<ServerEvents, ClientEvents> = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(c); await new Promise<void>(r => c.once('connect', r)); return c;
  }
  const a = await connect(), b = await connect(), c = await connect();
  let view!: RoomView, session!: ReconnectSession;
  a.on('room:state', v => { view = v; }); c.on('room:session', s => { session = s; });
  await a.emitWithAck('room:create', 'a');
  const code = view.code;
  await b.emitWithAck('room:join', code, 'b');
  await a.emitWithAck('room:ready', true); await b.emitWithAck('room:ready', true); await a.emitWithAck('room:start');
  const before = JSON.stringify(view);
  assert.equal((await c.emitWithAck('room:spectate', { roomCode: code })).ok, true);
  c.disconnect();
  await new Promise(r => setTimeout(r, 100));
  const restored = await connect();
  assert.equal((await restored.emitWithAck('room:spectator-resume', { roomCode: code, token: session.token })).ok, false);
  assert.equal((await restored.emitWithAck('room:spectate', { roomCode: code })).ok, true);
  await a.emitWithAck('room:sync'); assert.equal(JSON.stringify(view), before);
  const closed = new Promise<void>(r => restored.once('room:closed', () => r()));
  await a.emitWithAck('room:leave'); await closed;
});
