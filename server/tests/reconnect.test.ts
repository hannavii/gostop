import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { io, type Socket } from "socket.io-client";
import type { AddressInfo } from "node:net";
import { createOnlineServer, RECONNECT_GRACE_MS } from "../app";
import { createMatch, type Match } from "../game";
import type { ClientEvents, GameAction, ReconnectSession, RoomView, ServerEvents } from "../../shared/online";
import type { GameMode } from "../../src/game/rules";
import type { HwatuCard } from "../../src/types/game";

type Peer = { socket: Socket<ServerEvents, ClientEvents>; view: RoomView | null; session: ReconnectSession | null; closed: string | null };
async function until(check: () => boolean) {
  const end = Date.now() + 3000;
  while (!check()) { if (Date.now() > end) throw new Error("Reconnect test timed out"); await delay(5); }
}
async function harness(t: TestContext, options: Parameters<typeof createOnlineServer>[0] = {}) {
  const server = createOnlineServer(options);
  server.http.listen(0, "127.0.0.1");
  await once(server.http, "listening");
  const peers: Peer[] = [];
  t.after(async () => {
    peers.forEach(p => p.socket.disconnect());
    await new Promise<void>(resolve => server.io.close(() => resolve()));
  });
  async function connect() {
    const socket: Peer["socket"] = io(`http://127.0.0.1:${(server.http.address() as AddressInfo).port}`, {
      forceNew: true, reconnection: false, transports: ["websocket"],
    });
    const peer: Peer = { socket, view: null, session: null, closed: null };
    peers.push(peer);
    socket.on("room:state", v => { peer.view = v; });
    socket.on("room:session", s => { peer.session = s; });
    socket.on("room:closed", reason => { peer.closed = reason; });
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
    return peer;
  }
  async function room(mode: GameMode) {
    const first = await connect();
    assert.equal((await first.socket.timeout(2000).emitWithAck("room:create-mode", mode)).ok, true);
    const players = [first];
    for (let i = 1; i < (mode === "gostop" ? 3 : 2); i++) {
      const peer = await connect();
      assert.equal((await peer.socket.timeout(2000).emitWithAck("room:join", first.view!.code)).ok, true);
      players.push(peer);
    }
    await until(() => players.every(p => !!p.view?.game && !!p.session));
    return players;
  }
  return { connect, room };
}
function move(peer: Peer, type: GameAction["type"], cardId?: string): GameAction {
  return { roomCode: peer.view!.code, revision: peer.view!.game!.revision, type, ...(cardId ? { cardId } : {}) };
}
function assertPrivacy(players: Peer[]) {
  for (const p of players) {
    const serialized = JSON.stringify(p.view);
    assert.ok(!serialized.includes('token'));
    for (const other of players.filter(o => o !== p)) {
      assert.ok(!serialized.includes(other.session!.token));
      for (const card of other.view!.game!.hand) assert.ok(!serialized.includes(`"${card.id}"`));
    }
    assert.ok(!('pile' in p.view!.game!));
    assert.ok(!('pending' in p.view!.game!));
    assert.ok(p.view!.game!.players.every(player => !('hand' in player)));
  }
}

for (const mode of ["matgo", "gostop"] as const) {
  test(`${mode}: refreshed sockets recover every original seat and exact private game state`, async t => {
    const h = await harness(t);
    const players = await h.room(mode);
    assert.equal(new Set(players.map(p => p.session!.token)).size, players.length);
    for (let seat = 0; seat < players.length; seat++) {
      const old = players[seat], session = old.session!;
      const before = structuredClone(old.view!.game);
      const observer = players[(seat + 1) % players.length];
      old.socket.disconnect();
      await until(() => observer.view!.connections[seat].connected === false);
      assert.equal(observer.closed, null);
      assert.equal(observer.view!.occupancy, players.length);
      assert.ok(observer.view!.connections[seat].reconnectDeadline! > Date.now());
      assert.equal(observer.view!.game!.revision, before!.revision);
      const fresh = await h.connect();
      assert.equal((await fresh.socket.timeout(2000).emitWithAck("room:resume", session)).ok, true);
      await until(() => observer.view!.connections[seat].connected);
      assert.equal(fresh.view!.you, seat);
      assert.equal(fresh.view!.code, old.view!.code);
      assert.deepEqual(fresh.view!.game, before);
      assert.equal(fresh.session!.token, session.token);
      players[seat] = fresh;
      assertPrivacy(players);
      // A lost resume ACK can be retried on the same socket without duplication.
      assert.equal((await fresh.socket.timeout(2000).emitWithAck("room:resume", session)).ok, true);
      assert.equal(fresh.view!.occupancy, players.length);
    }
    const actor = players[0];
    assert.equal((await actor.socket.timeout(2000).emitWithAck("game:action", move(actor, "play", actor.view!.game!.hand[0].id))).ok, true);
    await until(() => players.every(p => p.view!.game!.revision === 1));
    assertPrivacy(players);
  });
}

test("resume rejects wrong tokens, cross-room replay, injected seat and existing-seat switching", async t => {
  const h = await harness(t);
  const players = await h.room("gostop");
  const stranger = await h.connect();
  const original = structuredClone(players.map(p => p.view));
  const session = players[0].session!;
  for (const payload of [null, {}, { ...session, token: "0".repeat(64) }, { ...session, seat: 2 }, { ...session, token: 10 }]) {
    assert.equal((await stranger.socket.timeout(2000).emitWithAck("room:resume", payload as ReconnectSession)).ok, false);
  }
  assert.equal(stranger.view, null);
  assert.equal(stranger.session, null);
  const otherRoom = await h.room("matgo");
  assert.equal((await stranger.socket.timeout(2000).emitWithAck("room:resume", { ...session, roomCode: otherRoom[0].view!.code })).ok, false);
  assert.equal((await players[1].socket.timeout(2000).emitWithAck("room:resume", session)).ok, false);
  assert.deepEqual(players.map(p => p.view), original);
});

test("online-socket takeover revokes old ownership, and its disconnect cannot evict the new seat", async t => {
  const h = await harness(t, { reconnectGraceMs: 300 });
  const players = await h.room("matgo");
  const old = players[0], fresh = await h.connect();
  assert.equal((await fresh.socket.timeout(2000).emitWithAck("room:resume", old.session!)).ok, true);
  await until(() => !old.socket.connected);
  assert.ok(old.closed);
  assert.equal(fresh.view!.you, 0);
  await delay(350);
  assert.equal(fresh.closed, null);
  assert.equal((await fresh.socket.timeout(2000).emitWithAck("room:sync")).ok, true);
  // The old socket can connect again, but has no room/seat authority until authenticated.
  old.socket.connect();
  await until(() => old.socket.connected);
  assert.equal((await old.socket.timeout(2000).emitWithAck("game:action", move(fresh, "play", fresh.view!.game!.hand[0].id))).ok, false);
});

for (const mode of ["matgo", "gostop"] as const) test(`${mode}: disconnect reserves seat, pauses its turn, rejects strangers and closes whole room on grace expiry`, async t => {
  assert.equal(RECONNECT_GRACE_MS, 60_000);
  const h = await harness(t, { reconnectGraceMs: 300 });
  const players = await h.room(mode), old = players[0];
  const before = structuredClone(players[1].view!.game);
  old.socket.disconnect();
  await until(() => !players[1].view!.connections[0].connected);
  assert.equal(players[1].closed, null);
  assert.deepEqual(players[1].view!.game, before);
  const stranger = await h.connect();
  assert.equal((await stranger.socket.timeout(2000).emitWithAck("room:join", old.view!.code)).ok, false);
  assert.equal((await players[1].socket.timeout(2000).emitWithAck("game:action", move(players[1], "play", players[1].view!.game!.hand[0].id))).ok, false);
  await until(() => players.slice(1).every(p => !!p.closed));
  assert.match(players[1].closed!, /만료/);
  assert.equal((await stranger.socket.timeout(2000).emitWithAck("room:resume", old.session!)).ok, false);
  assert.equal((await players[1].socket.timeout(2000).emitWithAck("room:sync")).ok, false);
});

test("a new server instance cannot recover an old process's token", async t => {
  const original = await harness(t);
  const players = await original.room("matgo");
  const replacement = await harness(t);
  const fresh = await replacement.connect();
  assert.equal((await fresh.socket.timeout(2000).emitWithAck("room:resume", players[0].session!)).ok, false);
  assert.equal(fresh.view, null);
  assert.equal(fresh.session, null);
});

test("waiting host can resume before game starts; recovery cancels old expiry; explicit leave invalidates token", async t => {
  const h = await harness(t, { reconnectGraceMs: 300 });
  const a = await h.connect(), observer = await h.connect();
  assert.equal((await a.socket.timeout(2000).emitWithAck("room:create-mode", "gostop")).ok, true);
  assert.equal((await observer.socket.timeout(2000).emitWithAck("room:join", a.view!.code)).ok, true);
  a.socket.disconnect();
  await until(() => !observer.view!.connections[0].connected);
  const fresh = await h.connect();
  assert.equal((await fresh.socket.timeout(2000).emitWithAck("room:resume", a.session!)).ok, true);
  assert.equal(fresh.view!.game, null);
  assert.equal(fresh.view!.occupancy, 2);
  await delay(350);
  assert.equal((await fresh.socket.timeout(2000).emitWithAck("room:sync")).ok, true);
  assert.equal((await fresh.socket.timeout(2000).emitWithAck("room:leave")).ok, true);
  assert.equal((await fresh.socket.timeout(2000).emitWithAck("room:resume", a.session!)).ok, false);
});

const card = (month: number, cardIndex: number): HwatuCard => ({ id: `${month}-${cardIndex}`, month, cardIndex, category: "pi", tags: [] });
function controlledMatch(mode: GameMode, scenario: "hand" | "draw" | "go-stop" | "special") {
  const m = createMatch(mode);
  m.players.forEach((p, i) => { p.hand = [card(7 + i, 1)]; p.captured = []; });
  m.players[0].hand = [card(1, 1), card(6, 1)];
  m.floor = scenario === "hand" ? [card(1, 2), card(1, 3)] : [card(2, 1), card(2, 2)];
  m.pile = [card(2, 3), card(3, 1)];
  if (scenario === "go-stop") {
    m.players[0].captured = Array.from({ length: mode === "matgo" ? 14 : 10 }, (_, i) => card(20 + i, 1));
    m.floor = [card(1, 2)]; m.pile = [card(3, 1)];
  }
  if (scenario === "special") {
    m.players[0].hand = [card(1, 1), card(1, 2), card(1, 3), card(6, 1)];
    m.players[0].bombCount = 1; m.players[0].bombPassCount = 2; m.players[0].shakeMonths = [5];
    m.ppeokStacks = [{ month: 4, owner: (mode === "matgo" ? 1 : 2) }];
    m.floor = [card(1, 4), card(4, 1), card(4, 2), card(4, 3)];
  }
  return m;
}
for (const mode of ["matgo", "gostop"] as const) for (const scenario of ["hand", "draw", "go-stop", "special"] as const) {
  test(`${mode}: resume restores ${scenario} including pending/private options, counters and final settlement`, async t => {
    const h = await harness(t, { matchFactory: (mode = "matgo"): Match => controlledMatch(mode, scenario) });
    const players = await h.room(mode);
    let actor = players[0];
    if (scenario !== "special") {
      assert.equal((await actor.socket.timeout(2000).emitWithAck("game:action", move(actor, "play", "1-1"))).ok, true);
      await until(() => players.every(p => p.view!.game!.revision === 1));
      assert.equal(actor.view!.game!.phase, scenario === "go-stop" ? "go-stop" : "choose");
    }
    async function refresh() {
      const before = structuredClone(actor.view!.game);
      const session = actor.session!;
      actor.socket.disconnect();
      await until(() => !players[1].view!.connections[0].connected);
      actor = await h.connect();
      assert.equal((await actor.socket.timeout(2000).emitWithAck("room:resume", session)).ok, true);
      players[0] = actor;
      assert.deepEqual(actor.view!.game, before);
      assertPrivacy(players);
    }
    await refresh();
    const state = actor.view!.game!;
    const type = scenario === "go-stop" ? "stop" : scenario === "special" ? "bomb" : "choose";
    const id = type === "choose" ? state.choice![0].id : type === "bomb" ? "1-1" : undefined;
    assert.equal((await actor.socket.timeout(2000).emitWithAck("game:action", move(actor, type, id))).ok, true);
    await until(() => players.every(p => p.view!.game!.revision === state.revision + 1));
    if (scenario === "go-stop") assert.equal(actor.view!.game!.phase, "finished");
    if (scenario === "special") {
      assert.equal(actor.view!.game!.players[0].bombCount, 2);
      assert.equal(actor.view!.game!.players[0].bombPassCount, 4);
    }
    await refresh();
  });
}
