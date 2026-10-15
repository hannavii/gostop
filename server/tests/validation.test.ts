import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { createOnlineServer } from '../app';
import { createMatch, parseAction, type Match } from '../game';
import { TurnTimer } from '../turnTimer';
import { GameLog } from '../gameLog';
import { REQUEST_FAILED } from '../validation';
import { hwatuCards } from '../../src/data/cards';
import type { GameAction, ReconnectSession, Reply, RoomView } from '../../shared/online';

type Peer = { socket: Socket; view: RoomView | null; session: ReconnectSession | null };
function socketEvent(socket: Socket, event: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { reject(new Error(`Timed out waiting for ${event}`)); }, 3000);
    socket.once(event, (...args: unknown[]) => { clearTimeout(timeout); resolve(args); });
  });
}
const card = (month: number, index = 0) => hwatuCards.filter(c => c.month === month)[index];
function fixture(): Match {
  const m = createMatch();
  m.players[0].hand = [card(1), card(2)];
  m.players[1].hand = [card(3), card(4)];
  m.floor = [card(5), card(6)]; m.pile = [card(7), card(8), card(9), card(10)];
  return m;
}
async function harness(t: TestContext, options: Parameters<typeof createOnlineServer>[0] = {}) {
  const server = createOnlineServer({ matchFactory: fixture, ...options });
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
  const peers: Peer[] = [];
  t.after(async () => { peers.forEach(p => p.socket.disconnect()); await new Promise<void>(resolve => server.io.close(() => resolve())); });
  async function connect() {
    const socket = io(`http://127.0.0.1:${(server.http.address() as AddressInfo).port}`, {
      transports: ['websocket'], forceNew: true, reconnection: false,
    });
    const p: Peer = { socket, view: null, session: null }; peers.push(p);
    socket.on('room:state', view => { p.view = view; });
    socket.on('room:session', session => { p.session = session; });
    await socketEvent(socket, 'connect'); return p;
  }
  async function room(start = true) {
    const a = await connect(), b = await connect();
    assert.equal((await send(a, 'room:create', ' Host ')).ok, true);
    assert.equal((await send(b, 'room:join', a.view!.code.toLowerCase(), 'Guest')).ok, true);
    for (const p of [a, b]) assert.equal((await send(p, 'room:ready', true)).ok, true);
    if (start) assert.equal((await send(a, 'room:start')).ok, true);
    await refresh([a, b]); return [a, b] as const;
  }
  return { server, connect, room };
}
function send(p: Peer, event: string, ...args: unknown[]): Promise<Reply> {
  return p.socket.timeout(3000).emitWithAck(event, ...args);
}
async function refresh(peers: readonly Peer[]) {
  // Each ACK follows the snapshot on that same ordered transport: no time-based wait.
  for (const p of peers) assert.equal((await send(p, 'room:sync')).ok, true);
}
function action(p: Peer, patch: Record<string, unknown> = {}) {
  return { roomCode: p.view!.code, revision: p.view!.game!.revision,
    type: 'play', cardId: p.view!.game!.hand[0].id, ...patch };
}
async function rejected(peers: readonly Peer[], actor: Peer, event: string, ...args: unknown[]) {
  await refresh(peers);
  const before = structuredClone(peers.map(p => p.view));
  const reply = await send(actor, event, ...args);
  assert.equal(reply.ok, false);
  assert.deepEqual(Object.keys(reply).sort(), ['error', 'ok']);
  if (!reply.ok) assert.equal(typeof reply.error, 'string');
  await refresh(peers);
  assert.deepEqual(peers.map(p => p.view), before, 'failed request must preserve game, log, timer and membership');
}

test('malformed create/join, nickname, room code and event arity never create membership', async t => {
  const h = await harness(t), host = await h.connect();
  await send(host, 'room:create', 'Host');
  const outsider = await h.connect();
  const invalid = [null, undefined, [], {}, 0, -1, NaN, Infinity, '', ' '.repeat(20), 'x'.repeat(2000), 'a\u0000b', 'a\u200bb'];
  for (const name of invalid) {
    await rejected([host], outsider, 'room:create', name);
    await rejected([host], outsider, 'room:join', host.view!.code, name);
  }
  for (const mode of [null, {}, [], 'unknown', '__proto__', 'constructor']) {
    await rejected([host], outsider, 'room:create-mode', mode, 'Name');
  }
  for (const code of [...invalid, '__proto__', 'constructor', 'prototype', 'ZZZZZZ', 'ABC!23', ' ABC123']) {
    await rejected([host], outsider, 'room:join', code, 'Name');
  }
  for (const [event, args] of [
    ['room:create', []], ['room:create', ['Name', { seat: 0 }]],
    ['room:create-mode', ['matgo']], ['room:join', [host.view!.code]],
    ['room:ready', [true, 0]], ['room:start', [{}]], ['room:leave', [{}]],
    ['room:sync', [{}]], ['room:resume', [{}, 0]], ['game:action', [{}, 0]], ['game:rematch', [{}, 0]],
  ] as [string, unknown[]][]) await rejected([host], outsider, event, ...args);
  // No ACK: a following ACK on the same transport is an ordering fence.
  outsider.socket.emit('room:create', 'Ignored');
  assert.equal((await send(outsider, 'room:create', 'Valid')).ok, true);
  assert.equal(outsider.view!.connections[0].nickname, 'Valid');
  await rejected([host, outsider], outsider, 'room:join', host.view!.code, 'Again');
});

test('lobby authorization, boolean validation, full room and duplicate start', async t => {
  let deals = 0;
  const h = await harness(t, { matchFactory: () => { deals++; return fixture(); } });
  const [a, b] = await h.room(false), outsider = await h.connect();
  await rejected([a, b], outsider, 'room:ready', true);
  await rejected([a, b], outsider, 'room:start');
  await rejected([a, b], outsider, 'room:leave');
  await rejected([a, b], b, 'room:start');
  for (const ready of [null, undefined, [], {}, 'true', 1, -1]) await rejected([a, b], a, 'room:ready', ready);
  await send(b, 'room:ready', false);
  await rejected([a, b], a, 'room:start');
  await send(b, 'room:ready', true);
  await rejected([a, b], outsider, 'room:join', a.view!.code, 'Third');
  const replies = await Promise.all([send(a, 'room:start'), send(a, 'room:start')]);
  assert.equal(replies.filter(r => r.ok).length, 1); assert.equal(deals, 1);
  await rejected([a, b], a, 'room:start');
  await rejected([a, b], a, 'room:ready', true);
  const lonely = await h.connect(); await send(lonely, 'room:create', 'Solo');
  await send(lonely, 'room:ready', true); await rejected([lonely], lonely, 'room:start');
});

test('action schemas, forged authority, wrong turn/card/round/revision and failed logs', async t => {
  const h = await harness(t), peers = await h.room(), [a, b] = peers, outsider = await h.connect();
  const move = action(a);
  const invalid = [null, undefined, [], {}, 'play', -1, ...[
    { seat: 1 }, { player: 0 }, { rematchReady: true }, { timeout: 1 }, { bombCount: 99 },
    { roomCode: '__proto__' }, { roomCode: 'ZZZZZZ' }, { roomCode: {} },
    { revision: -1 }, { revision: 0.5 }, { revision: NaN }, { revision: Infinity },
    { revision: 100 }, { revision: '0' }, { round: 0 }, { round: 2 }, { round: NaN },
    { type: 'unknown' }, { type: 'constructor' }, { cardId: null }, { cardId: [] },
    { cardId: '' }, { cardId: 'x'.repeat(65) }, { cardId: 'missing' }, { cardId: b.view!.game!.hand[0].id },
  ].map(patch => ({ ...move, ...patch })),
    ...['roomCode', 'revision', 'type', 'cardId'].map(key => Object.fromEntries(Object.entries(move).filter(([k]) => k !== key))),
  ];
  for (const input of invalid) await rejected(peers, a, 'game:action', input);
  await rejected(peers, b, 'game:action', move);
  await rejected(peers, outsider, 'game:action', move);
  for (const type of ['choose', 'go', 'stop', 'bomb', 'shake', 'bomb-pass']) {
    const input = { ...move, type } as Record<string, unknown>;
    if (['go', 'stop', 'bomb-pass'].includes(type)) delete input.cardId;
    await rejected(peers, a, 'game:action', input);
  }
  const replies = await Promise.all([send(a, 'game:action', { ...move, round: 1 }), send(a, 'game:action', move)]);
  assert.equal(replies.filter(r => r.ok).length, 1);
  await refresh(peers); assert.equal(a.view!.game!.revision, 1);
  await rejected(peers, a, 'game:action', move);
  await rejected(peers, a, 'game:action', action(a, { cardId: move.cardId }));
});

test('matching candidates survive invalid requests; duplicate choice applies once', async t => {
  const h = await harness(t, { matchFactory: () => { const m = fixture(); m.floor = [card(1, 1), card(1, 2)]; return m; } });
  const peers = await h.room(), [a, b] = peers;
  await send(a, 'game:action', action(a)); await refresh(peers);
  assert.equal(a.view!.game!.phase, 'choose');
  const choose = action(a, { type: 'choose', cardId: a.view!.game!.choice![0].id });
  for (const patch of [{ cardId: b.view!.game!.hand[0].id }, { cardId: 'missing' }, { revision: 0 }, { revision: 999 }]) {
    await rejected(peers, a, 'game:action', { ...choose, ...patch });
  }
  await rejected(peers, b, 'game:action', choose);
  const replies = await Promise.all([send(a, 'game:action', choose), send(a, 'game:action', choose)]);
  assert.equal(replies.filter(r => r.ok).length, 1);
  await refresh(peers); assert.equal(a.view!.game!.revision, 2);
  assert.equal(a.view!.game!.choice, null);
});

test('STOP and rematch retries cannot create settlement or a new deal twice; stale round rejects', async t => {
  let deals = 0;
  const h = await harness(t, { matchFactory: () => { const m = fixture(); if (++deals === 1) m.phase = 'go-stop'; return m; } });
  const peers = await h.room(), [a, b] = peers, outsider = await h.connect();
  const vote = { roomCode: a.view!.code, round: 1, ready: true };
  await rejected(peers, a, 'game:rematch', vote);
  const stop = action(a, { type: 'stop' }); delete (stop as Partial<GameAction>).cardId;
  await rejected(peers, b, 'game:action', stop);
  const replies = await Promise.all([send(a, 'game:action', stop), send(a, 'game:action', stop)]);
  assert.equal(replies.filter(r => r.ok).length, 1);
  await refresh(peers); assert.equal(a.view!.game!.phase, 'finished');
  await rejected(peers, a, 'game:action', action(a, { type: 'go', cardId: undefined }));
  await rejected(peers, outsider, 'game:rematch', vote);
  for (const input of [null, undefined, [], {}, 'ready', { ...vote, seat: 1 }, { ...vote, ready: 1 },
    { ...vote, round: -1 }, { ...vote, round: Infinity }, { ...vote, round: 2 }, { ...vote, roomCode: 'ZZZZZZ' }]) {
    await rejected(peers, a, 'game:rematch', input);
  }
  assert.equal((await send(a, 'game:rematch', vote)).ok, true);
  await refresh(peers); const voted = structuredClone(a.view);
  assert.equal((await send(a, 'game:rematch', vote)).ok, true);
  assert.deepEqual(a.view, voted); assert.equal(deals, 1);
  const last = await Promise.all([send(b, 'game:rematch', vote), send(b, 'game:rematch', vote)]);
  assert.equal(last.filter(r => r.ok).length, 1); assert.equal(deals, 2);
  await refresh(peers); assert.equal(a.view!.round, 2);
  await rejected(peers, a, 'game:rematch', vote);
  await rejected(peers, a, 'game:action', stop);
  await rejected(peers, a, 'game:action', action(a, { round: 1 }));
});

test('reconnect rejects malformed/foreign credentials and seat switching; retries preserve deadline', async t => {
  const h = await harness(t), peers = await h.room(), [a, b] = peers;
  const foreign = await h.connect(); await send(foreign, 'room:create', 'Foreign');
  const outsider = await h.connect(), session = a.session!;
  for (const input of [null, undefined, [], {}, 'token', { ...session, token: null },
    { ...session, token: 'x'.repeat(2000) }, { ...session, token: 'a'.repeat(64) },
    { ...session, seat: 0 }, { ...session, token: foreign.session!.token },
    { ...session, roomCode: foreign.view!.code }, { ...session, roomCode: '__proto__' }]) {
    await rejected(peers, outsider, 'room:resume', input);
  }
  await rejected(peers, b, 'room:resume', session);
  await rejected(peers, foreign, 'room:resume', session);
  await refresh(peers); const before = structuredClone(a.view);
  for (const reply of await Promise.all([send(a, 'room:resume', session), send(a, 'room:resume', session)])) assert.equal(reply.ok, true);
  await refresh(peers); assert.deepEqual(a.view, before, 'same-connection retry must not reset turn deadline or log');
  // Bearer token F5 takeover remains supported; the old transport is revoked.
  const oldDisconnected = socketEvent(a.socket, 'disconnect');
  assert.equal((await send(outsider, 'room:resume', session)).ok, true);
  await oldDisconnected; await refresh([outsider, b]);
  assert.equal(outsider.view!.you, 0); assert.equal(outsider.view!.connections[0].nickname, 'Host');
  assert.equal(outsider.view!.logs!.filter(e => e.type === 'reconnect').length, 1);
  const retryBefore = structuredClone(outsider.view);
  await send(outsider, 'room:resume', session); await refresh([outsider, b]);
  assert.deepEqual(outsider.view, retryBefore);
});

test('expired reconnect rejects credentials and cancels active room', async t => {
  const h = await harness(t, { reconnectGraceMs: 50 }), [a, b] = await h.room();
  const session = a.session!, closed = socketEvent(b.socket, 'room:closed');
  a.socket.disconnect(); await closed;
  const fresh = await h.connect(); assert.equal((await send(fresh, 'room:resume', session)).ok, false);
  assert.equal((await send(fresh, 'room:create', 'AfterExpiry')).ok, true);
});

test('public snapshots including logs contain no credentials, private hands or internal fields', async t => {
  const h = await harness(t), peers = await h.room();
  for (const viewer of peers) {
    const wire = JSON.stringify(viewer.view);
    for (const p of peers) {
      assert.ok(!wire.includes(p.session!.token)); assert.ok(!wire.includes(p.socket.id!));
      if (p !== viewer) for (const c of p.view!.game!.hand) assert.ok(!wire.includes(`"${c.id}"`));
    }
    const forbidden = new Set(['token', 'tokenHash', 'socketId', 'timer', 'generation', 'members', 'pile', 'pending']);
    function inspect(value: unknown) {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) { assert.ok(!forbidden.has(key), key); inspect(child); }
    }
    inspect(viewer.view);
  }
  await send(peers[0], 'game:action', action(peers[0])); await refresh(peers);
  for (const entry of peers[1].view!.logs!) {
    assert.ok(!('cardId' in entry.payload)); assert.ok(!('hand' in entry.payload)); assert.ok(!('token' in entry.payload));
  }
});

test('raw numeric non-finite values and prototype keys are rejected before wire serialization', () => {
  const base = { roomCode: 'ABC123', revision: 0, type: 'play', cardId: '1-1' };
  for (const value of [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseAction({ ...base, revision: value }));
    assert.throws(() => parseAction({ ...base, round: value }));
  }
  assert.throws(() => parseAction(Object.assign(Object.create({ seat: 1 }), base)));
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => parseAction(JSON.parse(JSON.stringify(base).slice(0, -1) + `,"${key}":{}}`)));
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('unexpected start and rematch factory errors are sanitized, diagnosed and leave state unchanged', async t => {
  const diagnostics: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { diagnostics.push(args); });
  let broken = true;
  const secret = 'private-token-and-C:\\server\\internal.ts';
  const h = await harness(t, { matchFactory: () => { if (broken) throw new Error(secret); const m = fixture(); m.phase = 'finished'; return m; } });
  const peers = await h.room(false), [a, b] = peers;
  await rejected(peers, a, 'room:start');
  assert.deepEqual(await send(a, 'room:start'), { ok: false, error: REQUEST_FAILED });
  broken = false; assert.equal((await send(a, 'room:start')).ok, true); await refresh(peers);
  const vote = { roomCode: a.view!.code, round: 1, ready: true };
  await send(a, 'game:rematch', vote); broken = true;
  await rejected(peers, b, 'game:rematch', vote);
  assert.ok(diagnostics.length >= 3); assert.ok(!JSON.stringify(diagnostics).includes(secret));
  assert.ok(JSON.stringify(diagnostics).includes('fingerprint'));
  broken = false; assert.equal((await send(b, 'game:rematch', vote)).ok, true);
  await refresh(peers); assert.equal(a.view!.round, 2);
});

test('unexpected turn callback exception closes only its room without crashing or exposing details', async t => {
  const diagnostics: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { diagnostics.push(args); });
  const h = await harness(t, { turnTimerFactory: () => {
    const timer = new TurnTimer(100);
    timer.fallback = () => { throw new Error('secret-runtime-path'); }; return timer;
  } });
  const [a, b] = await h.room(false);
  const closed = socketEvent(b.socket, 'room:closed'); await send(a, 'room:start');
  assert.deepEqual(await closed, [REQUEST_FAILED]);
  assert.ok(!JSON.stringify(diagnostics).includes('secret-runtime-path'));
  assert.equal((await send(b, 'room:create', 'StillAlive')).ok, true);
});

test('GO retries increment the counter once and mandatory passes cannot be bypassed', async t => {
  const h = await harness(t, { matchFactory: () => { const m = fixture(); m.phase = 'go-stop'; return m; } });
  const peers = await h.room(), [a, b] = peers;
  const go = action(a, { type: 'go', cardId: undefined });
  await rejected(peers, b, 'game:action', go);
  const replies = await Promise.all([send(a, 'game:action', go), send(a, 'game:action', go)]);
  assert.equal(replies.filter(r => r.ok).length, 1); await refresh(peers);
  assert.equal(a.view!.game!.players[0].goCount, 1);
  assert.equal(a.view!.logs!.filter(e => e.type === 'go').length, 1);

  const passes = await harness(t, { matchFactory: () => { const m = fixture(); m.players[0].bombPassCount = 1; return m; } });
  const passPeers = await passes.room(), actor = passPeers[0];
  for (const type of ['play', 'bomb', 'shake']) await rejected(passPeers, actor, 'game:action', action(actor, { type }));
  const pass = action(actor, { type: 'bomb-pass', cardId: undefined });
  const passReplies = await Promise.all([send(actor, 'game:action', pass), send(actor, 'game:action', pass)]);
  assert.equal(passReplies.filter(r => r.ok).length, 1); await refresh(passPeers);
  assert.equal(actor.view!.game!.players[0].bombPassCount, 0);
});

test('action before match and repeated explicit leave preserve room lifecycle', async t => {
  const h = await harness(t), [a, b] = await h.room(false);
  await rejected([a, b], a, 'game:action', { roomCode: a.view!.code, revision: 0, type: 'stop' });
  assert.equal((await send(b, 'room:leave')).ok, true);
  await rejected([a], b, 'room:leave'); assert.equal(a.view!.occupancy, 1);
});

test('unexpected logging failure rolls back both match and log sequence', async t => {
  t.mock.method(console, 'error', () => {});
  const h = await harness(t), peers = await h.room(), a = peers[0];
  const original = GameLog.prototype.action;
  const faulty = t.mock.method(GameLog.prototype, 'action', function (this: GameLog, ...args: Parameters<GameLog['action']>) {
    original.apply(this, args); throw new Error('private-log-internal');
  });
  const move = action(a); await rejected(peers, a, 'game:action', move);
  faulty.mock.restore(); assert.equal((await send(a, 'game:action', move)).ok, true);
  await refresh(peers); assert.equal(a.view!.game!.revision, 1);
  assert.equal(a.view!.logs![1].sequence, 2);
});

test('resume that would start rematch prepares the deal before changing ownership', async t => {
  t.mock.method(console, 'error', () => {});
  let broken = false;
  const h = await harness(t, { matchFactory: () => {
    if (broken) throw new Error('private-resume-factory');
    const m = fixture(); m.phase = 'finished'; return m;
  } });
  const [a, b] = await h.room(), session = a.session!;
  const vote = { roomCode: a.view!.code, round: 1, ready: true };
  await send(a, 'game:rematch', vote); await refresh([a, b]);
  const disconnected = socketEvent(b.socket, 'room:state'); a.socket.disconnect(); await disconnected;
  await send(b, 'game:rematch', vote); await refresh([b]);
  broken = true; const fresh = await h.connect();
  await rejected([b], fresh, 'room:resume', session);
  assert.equal(fresh.session, null); assert.equal(fresh.view, null);
  broken = false; assert.equal((await send(fresh, 'room:resume', session)).ok, true);
  await refresh([fresh, b]); assert.equal(fresh.view!.round, 2); assert.equal(fresh.view!.you, 0);
});
