import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";
import type { AddressInfo } from "node:net";
import { createOnlineServer } from "../app";
import type { ClientEvents, GameAction, GameView, RoomView, Seat, ServerEvents } from "../../shared/online";

type Client = Socket<ServerEvents, ClientEvents>;
async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for synchronized snapshots");
    await delay(5);
  }
}

test("real Socket.IO clients: rooms, privacy, validation, full round, isolation and disconnect", { timeout: 15000 }, async t => {
  const server = createOnlineServer();
  server.http.listen(0, "127.0.0.1");
  await once(server.http, "listening");
  const url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  const clients: Client[] = [];
  const views: (RoomView | null)[] = [];
  const closed: string[] = [];
  t.after(async () => {
    clients.forEach(client => client.disconnect());
    await new Promise<void>(resolve => server.io.close(() => resolve()));
  });
  for (let i = 0; i < 4; i++) {
    const client: Client = io(url, { transports: ["websocket"], reconnection: false, forceNew: true });
    clients.push(client);
    views.push(null);
    client.on("room:state", view => { views[i] = view; });
    client.on("room:closed", reason => { closed[i] = reason; });
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
  }
  const [a, b, outsider, d] = clients;
  assert.equal((await b.timeout(2000).emitWithAck("room:join", "------", "Guest")).ok, false);
  assert.equal((await a.timeout(2000).emitWithAck("room:create", "Host")).ok, true);
  assert.equal(views[0]?.occupancy, 1);
  assert.equal(views[0]?.game, null);
  const code = views[0]!.code;
  assert.equal((await a.timeout(2000).emitWithAck("room:create", "Host")).ok, false);
  assert.equal((await b.timeout(2000).emitWithAck("room:join", code.toLowerCase(), "Guest")).ok, true);
  for (const client of [a, b]) assert.equal((await client.emitWithAck("room:ready", true)).ok, true);
  assert.equal((await a.emitWithAck("room:start")).ok, true);
  await until(() => !!views[0]?.game && !!views[1]?.game);
  assert.equal((await outsider.timeout(2000).emitWithAck("room:join", code, "Guest")).ok, false);
  assert.equal((await outsider.timeout(2000).emitWithAck("room:create", "Host")).ok, true);
  const isolated = structuredClone(views[2]);
  const initial = views[0]!.game!;
  const move: GameAction = { roomCode: code, revision: initial.revision, type: "play", cardId: initial.hand[0].id };
  assert.equal((await outsider.timeout(2000).emitWithAck("game:action", move)).ok, false);
  assert.equal((await b.timeout(2000).emitWithAck("game:action", move)).ok, false);
  assert.equal((await a.timeout(2000).emitWithAck("game:action", { ...move, cardId: views[1]!.game!.hand[0].id })).ok, false);
  // Runtime payloads can ignore TypeScript. Forged player identities must be rejected.
  assert.equal((await a.timeout(2000).emitWithAck("game:action", { ...move, seat: 1 } as GameAction)).ok, false);
  assert.equal((await a.timeout(2000).emitWithAck("game:action", null as unknown as GameAction)).ok, false);

  function checkViews() {
    const x = views[0]!.game!, y = views[1]!.game!;
    assert.deepEqual({ ...x, hand: null, choice: null, specialOptions: null }, { ...y, hand: null, choice: null, specialOptions: null });
    assert.equal(x.hand.length, x.players[0].handCount);
    assert.equal(y.hand.length, y.players[1].handCount);
    for (const [own, opponent] of [[x, y], [y, x]]) {
      const serialized = JSON.stringify(own);
      for (const card of opponent.hand) assert.ok(!serialized.includes(`"id":"${card.id}"`));
      assert.ok(!("pile" in own));
      assert.ok(!("pending" in own));
      assert.ok(own.players.every(p => !("hand" in p)));
    }
    assert.deepEqual(views[2], isolated);
  }
  checkViews();
  assert.equal((await a.timeout(2000).emitWithAck("game:action", move)).ok, true);
  assert.equal((await a.timeout(2000).emitWithAck("game:action", move)).ok, false);
  await until(() => views[1]?.game?.revision === views[0]?.game?.revision);
  checkViews();

  for (let step = 0; step < 100 && views[0]!.game!.phase !== "finished"; step++) {
    const state: GameView = views[0]!.game!;
    const actor: Seat = state.turn;
    const own = views[actor]!.game!;
    const next: GameAction = { roomCode: code, revision: state.revision, type: "stop" };
    if (state.phase === "play") { next.type = "play"; next.cardId = own.hand[0].id; }
    if (state.phase === "choose") { next.type = "choose"; next.cardId = own.choice![0].id; }
    assert.equal((await clients[actor].timeout(2000).emitWithAck("game:action", next)).ok, true);
    await until(() => views[0]?.game?.revision === state.revision + 1 && views[1]?.game?.revision === state.revision + 1);
    checkViews();
  }
  assert.equal(views[0]!.game!.phase, "finished");
  assert.deepEqual(views[0]!.game!.result, views[1]!.game!.result);

  assert.equal((await b.timeout(2000).emitWithAck("room:leave")).ok, true);
  await until(() => Boolean(closed[0]));
  assert.equal((await a.timeout(2000).emitWithAck("game:action", move)).ok, false);
  assert.equal((await d.timeout(2000).emitWithAck("room:join", code, "Guest")).ok, false);
  assert.equal((await a.timeout(2000).emitWithAck("room:create", "Host")).ok, true);
  const waitingCode = views[0]!.code;
  assert.equal((await a.timeout(2000).emitWithAck("room:leave")).ok, true);
  assert.equal((await d.timeout(2000).emitWithAck("room:join", waitingCode, "Guest")).ok, false);
});

for (const mode of ["matgo", "gostop"] as const) test(`${mode} browser connection path: Vite proxy accepts default polling and WebSocket upgrade`, { timeout: 15000 }, async t => {
  const { createServer } = await import("vite");
  const server = createOnlineServer();
  server.http.listen(0, "127.0.0.1");
  await once(server.http, "listening");
  const target = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  const vite = await createServer({
    server: { host: "127.0.0.1", port: 0, proxy: { "/socket.io": { target, ws: true } } },
    logLevel: "error",
  });
  const clients: Client[] = [];
  t.after(async () => {
    clients.forEach(client => client.disconnect());
    await vite.close();
    await new Promise<void>(resolve => server.io.close(() => resolve()));
  });
  await vite.listen();
  const url = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
  assert.equal((await fetch(url)).status, 200);
  const count = mode === "gostop" ? 3 : 2;
  const views: (RoomView | null)[] = Array.from({ length: count }, () => null);
  for (let i = 0; i < count; i++) {
    const client: Client = io(url, { reconnection: false, forceNew: true });
    clients.push(client);
    client.on("room:state", view => { views[i] = view; });
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
  }
  assert.equal((await clients[0].timeout(2000).emitWithAck("room:create-mode", mode, "Host")).ok, true);
  for (let i = 1; i < count; i++) assert.equal((await clients[i].timeout(2000).emitWithAck("room:join", views[0]!.code, "Guest")).ok, true);
  for (const client of clients) assert.equal((await client.emitWithAck("room:ready", true)).ok, true);
  assert.equal((await clients[0].emitWithAck("room:start")).ok, true);
  await until(() => views.every(v => !!v?.game));
  const view = views[0]!;
  assert.equal((await clients[0].timeout(2000).emitWithAck("game:action", {
    roomCode: view.code, revision: view.game!.revision, type: "play", cardId: view.game!.hand[0].id,
  })).ok, true);
  await until(() => views.every(v => v?.game?.revision === 1));
  await until(() => clients.every(client => client.io.engine.transport.name === "websocket"));
});

test("three real clients: waiting, capacity, privacy, invalid actions, full round, sync and disconnect", { timeout: 15000 }, async t => {
  const server = createOnlineServer();
  server.http.listen(0, "127.0.0.1");
  await once(server.http, "listening");
  const url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  const clients: Client[] = [];
  const views: (RoomView | null)[] = [null, null, null, null];
  const closed: string[] = [];
  t.after(async () => {
    clients.forEach(c => c.disconnect());
    await new Promise<void>(resolve => server.io.close(() => resolve()));
  });
  for (let i = 0; i < 4; i++) {
    const client: Client = io(url, { reconnection: false, forceNew: true });
    clients.push(client);
    client.on("room:state", view => { views[i] = view; });
    client.on("room:closed", reason => { closed[i] = reason; });
    await new Promise<void>((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); });
  }
  const [a, b, c, fourth] = clients;
  assert.equal((await a.timeout(2000).emitWithAck("room:create-mode", "forged" as "gostop", "Host")).ok, false);
  assert.equal((await a.timeout(2000).emitWithAck("room:create-mode", "gostop", "Host")).ok, true);
  const code = views[0]!.code;
  assert.equal(views[0]!.mode, "gostop");
  assert.equal(views[0]!.capacity, 3);
  assert.equal(views[0]!.game, null);
  assert.equal((await b.timeout(2000).emitWithAck("room:join", code, "Guest")).ok, true);
  await until(() => views[0]?.occupancy === 2 && views[1]?.occupancy === 2);
  assert.equal(views[0]!.game, null);
  assert.equal(views[1]!.game, null);
  assert.equal((await a.timeout(2000).emitWithAck("game:action", { roomCode: code, revision: 0, type: "play", cardId: "1-1" })).ok, false);
  assert.equal((await c.timeout(2000).emitWithAck("room:join", code, "Guest")).ok, true);
  for (const client of [a, b, c]) assert.equal((await client.emitWithAck("room:ready", true)).ok, true);
  assert.equal((await a.emitWithAck("room:start")).ok, true);
  await until(() => views.slice(0, 3).every(v => !!v?.game));
  assert.equal((await fourth.timeout(2000).emitWithAck("room:join", code, "Guest")).ok, false);
  assert.deepEqual(views.slice(0, 3).map(v => v!.you), [0, 1, 2]);
  assert.deepEqual(views.slice(0, 3).map(v => v!.game!.hand.length), [7, 7, 7]);
  assert.equal(views[0]!.game!.floor.length, 6);
  assert.equal(views[0]!.game!.drawCount, 21);
  // A separate two-player lobby must remain isolated from this three-player game.
  assert.equal((await fourth.timeout(2000).emitWithAck("room:create", "Host")).ok, true);
  const isolated = structuredClone(views[3]);
  function checkViews() {
    const games = views.slice(0, 3).map(v => v!.game!);
    const publicState = (g: GameView) => ({ ...g, hand: null, choice: null, specialOptions: null });
    for (let viewer = 0; viewer < 3; viewer++) {
      const own = games[viewer];
      assert.deepEqual(publicState(own), publicState(games[0]));
      assert.equal(own.hand.length, own.players[viewer].handCount);
      assert.ok(!("pile" in own)); assert.ok(!("pending" in own));
      for (let other = 0; other < 3; other++) if (other !== viewer) {
        for (const card of games[other].hand) assert.ok(!JSON.stringify(own).includes(`"${card.id}"`));
      }
      if (own.turn !== viewer) { assert.equal(own.choice, null); assert.deepEqual(own.specialOptions, []); }
    }
    assert.deepEqual(views[3], isolated);
  }
  checkViews();
  const first = views[0]!.game!;
  const move: GameAction = { roomCode: code, revision: first.revision, type: "play", cardId: first.hand[0].id };
  for (const wrong of [b, c, fourth]) assert.equal((await wrong.timeout(2000).emitWithAck("game:action", move)).ok, false);
  for (const other of [1, 2]) assert.equal((await a.timeout(2000).emitWithAck("game:action", { ...move, cardId: views[other]!.game!.hand[0].id })).ok, false);
  assert.equal((await a.timeout(2000).emitWithAck("game:action", { ...move, seat: 2 } as GameAction)).ok, false);
  const visited = new Set<number>();
  for (let step = 0; step < 100 && views[0]!.game!.phase !== "finished"; step++) {
    const state: GameView = views[0]!.game!;
    const actor: Seat = state.turn;
    visited.add(actor);
    const own = views[actor]!.game!, option = own.specialOptions[0];
    const type = own.phase === "choose" ? "choose" : own.phase === "go-stop" ? "stop"
      : option ? option.type : own.players[actor].bombPassCount ? "bomb-pass" : "play";
    const cardId = type === "choose" ? own.choice![0].id : type === "play" ? own.hand[0].id
      : type === "bomb" || type === "shake" ? option!.cardId : undefined;
    const next: GameAction = { roomCode: code, revision: state.revision, type, ...(cardId ? { cardId } : {}) };
    assert.equal((await clients[actor].timeout(2000).emitWithAck("game:action", next)).ok, true);
    assert.equal((await clients[actor].timeout(2000).emitWithAck("game:action", next)).ok, false);
    await until(() => views.slice(0, 3).every(v => v?.game?.revision === state.revision + 1));
    checkViews();
    const after: GameView = views[0]!.game!;
    if (after.phase === "play") assert.equal(after.turn, (actor + 1) % 3);
    else if (after.phase !== "finished") assert.equal(after.turn, actor);
  }
  assert.equal(views[0]!.game!.phase, "finished");
  // A lucky first-turn score can end early; turn order is also checked deterministically in gostop.test.ts.
  assert.ok(visited.has(0));
  const beforeSync = structuredClone(views.slice(0, 3));
  assert.equal((await c.timeout(2000).emitWithAck("room:sync")).ok, true);
  assert.deepEqual(views.slice(0, 3), beforeSync);
  assert.equal((await c.timeout(2000).emitWithAck("room:leave")).ok, true);
  await until(() => Boolean(closed[0] && closed[1]));
  assert.equal((await a.timeout(2000).emitWithAck("game:action", move)).ok, false);
  assert.equal((await b.timeout(2000).emitWithAck("room:join", code, "Guest")).ok, false);
  assert.deepEqual(views[3], isolated);
});
