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
  assert.equal((await b.timeout(2000).emitWithAck("room:join", "------")).ok, false);
  assert.equal((await a.timeout(2000).emitWithAck("room:create")).ok, true);
  assert.equal(views[0]?.occupancy, 1);
  assert.equal(views[0]?.game, null);
  const code = views[0]!.code;
  assert.equal((await a.timeout(2000).emitWithAck("room:create")).ok, false);
  assert.equal((await b.timeout(2000).emitWithAck("room:join", code.toLowerCase())).ok, true);
  await until(() => !!views[0]?.game && !!views[1]?.game);
  assert.equal((await outsider.timeout(2000).emitWithAck("room:join", code)).ok, false);
  assert.equal((await outsider.timeout(2000).emitWithAck("room:create")).ok, true);
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

  b.disconnect();
  await until(() => Boolean(closed[0]));
  assert.equal((await a.timeout(2000).emitWithAck("game:action", move)).ok, false);
  assert.equal((await d.timeout(2000).emitWithAck("room:join", code)).ok, false);
  assert.equal((await a.timeout(2000).emitWithAck("room:create")).ok, true);
  const waitingCode = views[0]!.code;
  assert.equal((await a.timeout(2000).emitWithAck("room:leave")).ok, true);
  assert.equal((await d.timeout(2000).emitWithAck("room:join", waitingCode)).ok, false);
});

test("browser connection path: Vite proxy accepts default polling and WebSocket upgrade", { timeout: 15000 }, async t => {
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
  const views: (RoomView | null)[] = [null, null];
  for (let i = 0; i < 2; i++) {
    const client: Client = io(url, { reconnection: false, forceNew: true });
    clients.push(client);
    client.on("room:state", view => { views[i] = view; });
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
  }
  assert.equal((await clients[0].timeout(2000).emitWithAck("room:create")).ok, true);
  assert.equal((await clients[1].timeout(2000).emitWithAck("room:join", views[0]!.code)).ok, true);
  await until(() => !!views[0]?.game && !!views[1]?.game);
  const view = views[0]!;
  assert.equal((await clients[0].timeout(2000).emitWithAck("game:action", {
    roomCode: view.code, revision: view.game!.revision, type: "play", cardId: view.game!.hand[0].id,
  })).ok, true);
  await until(() => views[1]?.game?.revision === 1);
  assert.equal(views[0]?.game?.revision, views[1]?.game?.revision);
  await until(() => clients.every(client => client.io.engine.transport.name === "websocket"));
});
