import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { createOnlineServer } from '../app';
import type { PublicRoomSummary, ReconnectSession, Reply, RoomView } from '../../shared/online';

type Peer = { socket: Socket; view: RoomView | null; session: ReconnectSession | null; changes: number; lists: number };
function event(socket: Socket, name: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Missing ${name}`)), 3000);
    socket.once(name, (...args: unknown[]) => { clearTimeout(timer); resolve(args); });
  });
}
async function setup(t: TestContext, reconnectGraceMs = 60_000) {
  const server = createOnlineServer({ reconnectGraceMs });
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
  const peers: Peer[] = [];
  t.after(async () => { peers.forEach(p => p.socket.disconnect()); await new Promise<void>(resolve => server.io.close(() => resolve())); });
  async function connect() {
    const socket = io(`http://127.0.0.1:${(server.http.address() as AddressInfo).port}`, {
      transports: ['websocket'], forceNew: true, reconnection: false,
    });
    const p: Peer = { socket, view: null, session: null, changes: 0, lists: 0 }; peers.push(p);
    socket.on('room:state', view => { p.view = view; }); socket.on('room:session', session => { p.session = session; });
    socket.on('room:list-changed', () => p.changes++); socket.on('room:list', () => p.lists++);
    await event(socket, 'connect'); return p;
  }
  async function create(mode: 'matgo' | 'gostop' = 'matgo', visibility: 'private' | 'public' = 'public') {
    const p = await connect();
    assert.equal((await send(p, 'room:create-options', { mode, nickname: 'HostSecret', visibility })).ok, true);
    return p;
  }
  return { connect, create };
}
function send(p: Peer, name: string, ...args: unknown[]): Promise<Reply> { return p.socket.timeout(3000).emitWithAck(name, ...args); }
async function list(p: Peer): Promise<PublicRoomSummary[]> {
  let rooms: PublicRoomSummary[] | undefined;
  const receive = (value: PublicRoomSummary[]) => { rooms = value; };
  p.socket.once('room:list', receive);
  try { assert.equal((await send(p, 'room:list')).ok, true); assert.ok(rooms); return rooms; }
  finally { p.socket.off('room:list', receive); }
}

test('legacy creation is private; summary is exact, minimal and newest first', async t => {
  const h = await setup(t), observer = await h.connect();
  assert.deepEqual(await list(observer), []);
  const legacy = await h.connect(); await send(legacy, 'room:create', 'Legacy');
  const legacyMode = await h.connect(); await send(legacyMode, 'room:create-mode', 'gostop', 'LegacyMode');
  const privateHost = await h.create('matgo', 'private');
  assert.deepEqual(await list(observer), []); assert.equal(observer.changes, 0);
  const a = await h.create(), b = await h.create('gostop');
  const rooms = await list(observer);
  assert.deepEqual(rooms, [
    { roomCode: b.view!.code, mode: 'gostop', playerCount: 1, maxPlayers: 3 },
    { roomCode: a.view!.code, mode: 'matgo', playerCount: 1, maxPlayers: 2 },
  ]);
  assert.equal(observer.changes, 2);
  const wire = JSON.stringify(rooms);
  for (const p of [legacy, legacyMode, privateHost, a, b]) {
    assert.ok(!wire.includes(p.session!.token)); assert.ok(!wire.includes(p.socket.id!));
  }
  for (const p of [legacy, legacyMode, privateHost]) assert.ok(!wire.includes(p.view!.code));
  assert.ok(!wire.includes('HostSecret'));
  for (const room of rooms) assert.deepEqual(Object.keys(room).sort(), ['maxPlayers', 'mode', 'playerCount', 'roomCode']);
  assert.deepEqual(a.view!.logs, []); assert.deepEqual(b.view!.logs, []);
});

test('private lifecycle sends neither summaries nor invalidation hints; code join still works', async t => {
  const h = await setup(t), observer = await h.connect(); await list(observer);
  const host = await h.create('matgo', 'private'), guest = await h.connect();
  assert.equal((await send(guest, 'room:join', host.view!.code.toLowerCase(), 'Guest')).ok, true);
  for (const p of [host, guest]) await send(p, 'room:ready', true);
  await send(host, 'room:start'); assert.deepEqual(await list(observer), []);
  await send(guest, 'room:leave'); assert.deepEqual(await list(observer), []);
  assert.equal(observer.changes, 0);
});

test('public occupancy follows joins/leaves/full/start/delete; only summary changes notify', async t => {
  const h = await setup(t), observer = await h.connect(); await list(observer);
  const host = await h.create('gostop'), b = await h.connect(), c = await h.connect();
  await send(b, 'room:join', host.view!.code, 'B');
  assert.equal((await list(observer))[0].playerCount, 2); assert.equal(observer.changes, 2);
  await send(b, 'room:ready', true); await send(host, 'room:sync');
  await list(observer); assert.equal(observer.changes, 2);
  await send(c, 'room:join', host.view!.code, 'C');
  assert.deepEqual(await list(observer), []); assert.equal(observer.changes, 3);
  await send(c, 'room:leave'); assert.equal((await list(observer))[0].playerCount, 2);
  await send(c, 'room:join', host.view!.code, 'C');
  for (const p of [host, b, c]) await send(p, 'room:ready', true);
  await send(host, 'room:start'); assert.deepEqual(await list(observer), []);
  assert.equal((await send(observer, 'room:join', host.view!.code, 'Late')).ok, false);
  await send(host, 'room:leave'); assert.deepEqual(await list(observer), []);
  const alone = await h.create(); assert.equal((await list(observer)).length, 1);
  await send(alone, 'room:leave'); assert.deepEqual(await list(observer), []);
});

test('concurrent stale quick joins and duplicate joins never overbook the final seat', async t => {
  const h = await setup(t), host = await h.create(), a = await h.connect(), b = await h.connect();
  const staleA = await list(a), staleB = await list(b);
  assert.equal(staleA[0].playerCount, 1); assert.equal(staleB[0].playerCount, 1);
  const results = await Promise.all([send(a, 'room:join', host.view!.code, 'A'), send(b, 'room:join', host.view!.code, 'B')]);
  assert.equal(results.filter(r => r.ok).length, 1);
  const winner = results[0].ok ? a : b, loser = results[0].ok ? b : a;
  assert.equal((await send(winner, 'room:join', host.view!.code, 'Again')).ok, false);
  await send(host, 'room:sync'); assert.equal(host.view!.occupancy, 2);
  assert.deepEqual(await list(loser), []);
  await send(host, 'room:ready', true); await send(winner, 'room:ready', true); await send(host, 'room:start');
  assert.equal((await send(loser, 'room:join', staleA[0].roomCode, 'Late')).ok, false);
  const logs = JSON.stringify(host.view!.logs); await list(loser); await send(host, 'room:sync');
  assert.equal(JSON.stringify(host.view!.logs), logs);
});

test('reserved grace seats count toward occupancy, remain resumable, and expire through lifecycle', async t => {
  const h = await setup(t, 600), observer = await h.connect(), host = await h.create('gostop'), guest = await h.connect();
  await send(guest, 'room:join', host.view!.code, 'Guest');
  const session = guest.session!;
  const offline = event(host.socket, 'room:state'); guest.socket.disconnect(); await offline;
  assert.equal((await list(observer))[0].playerCount, 2);
  const third = await h.connect(); await send(third, 'room:join', host.view!.code, 'Third');
  assert.deepEqual(await list(observer), []);
  const fourth = await h.connect(); assert.equal((await send(fourth, 'room:join', host.view!.code, 'Fourth')).ok, false);
  const fresh = await h.connect(); assert.equal((await send(fresh, 'room:resume', session)).ok, true);
  assert.equal(fresh.view!.you, 1); assert.equal(fresh.view!.connections[1].nickname, 'Guest');
  const offlineAgain = event(host.socket, 'room:state'); fresh.socket.disconnect(); await offlineAgain;
  const changed = event(observer.socket, 'room:list-changed'); await changed;
  assert.equal((await list(observer))[0].playerCount, 2);
  const expired = await h.connect(); assert.equal((await send(expired, 'room:resume', session)).ok, false);
});

test('sole public host grace expiry deletes the room and notifies watchers', async t => {
  const h = await setup(t, 100), observer = await h.connect(), host = await h.create();
  await list(observer); const session = host.session!;
  const removed = event(observer.socket, 'room:list-changed'); host.socket.disconnect(); await removed;
  assert.deepEqual(await list(observer), []);
  assert.equal((await send(observer, 'room:resume', session)).ok, false);
});

test('malformed creation and list requests leave rooms and credentials unchanged', async t => {
  const h = await setup(t), observer = await h.connect(); await list(observer);
  const base = { mode: 'matgo', nickname: 'Host', visibility: 'public' };
  for (const input of [null, undefined, [], {}, 'public', ...[null, undefined, [], {}, 'public123', 1, '__proto__'].map(visibility => ({ ...base, visibility })),
    { ...base, mode: 'bad' }, { ...base, nickname: ' ' }, { ...base, seat: 1 },
    { ...base, roomCode: 'ABC123' }, { ...base, rematchReady: true }, { ...base, nickname: 'x'.repeat(2000) }]) {
    const caller = await h.connect();
    assert.equal((await send(caller, 'room:create-options', input)).ok, false);
    assert.equal(caller.view, null); assert.equal(caller.session, null);
    assert.deepEqual(await list(observer), []);
  }
  for (const payload of [null, undefined, [], {}, 'list', 1]) {
    const before = observer.lists;
    assert.equal((await send(observer, 'room:list', payload)).ok, false);
    assert.equal(observer.lists, before);
  }
  assert.equal(observer.changes, 0);
  const caller = await h.connect();
  assert.equal((await send(caller, 'room:create-options', base, { visibility: 'private' })).ok, false);
  assert.equal((await send(caller, 'room:create-options', base)).ok, true);
  assert.equal((await list(observer)).length, 1);
  const before = JSON.stringify(caller.view);
  assert.equal((await send(caller, 'room:create-options', { ...base, visibility: 'private' })).ok, false);
  await send(caller, 'room:sync'); assert.equal(JSON.stringify(caller.view), before);
});
