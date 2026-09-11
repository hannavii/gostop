import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { io, type Socket } from "socket.io-client";
import { createOnlineServer } from "../app";
import { readServerConfig } from "../config";
import type { ClientEvents, RoomView, ServerEvents } from "../../shared/online";

test("deployment config: local defaults, production binding, exact origins and invalid settings", () => {
  assert.deepEqual(readServerConfig({}), {
    port: 3001, host: "127.0.0.1", allowedOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"], allowMissingOrigin: true,
  });
  const config = readServerConfig({ NODE_ENV: "production", PORT: "8080", ALLOWED_ORIGINS: "https://play.example.com, https://other.example.com" });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8080);
  assert.equal(config.allowMissingOrigin, false);
  assert.equal(config.allowedOrigins.length, 2);
  assert.equal(readServerConfig({ HOST: "127.0.0.2" }).host, "127.0.0.2");
  for (const PORT of ["", "0", "-1", "65536", "1.5", "abc", " 3001"]) assert.throws(() => readServerConfig({ PORT }), /PORT/);
  for (const ALLOWED_ORIGINS of [undefined, "", "*", "https://*.example.com", "null", "https://play.example.com/", "https://play.example.com/path", "https://user:pass@example.com", "https://example.com,"]) {
    assert.throws(() => readServerConfig({ NODE_ENV: "production", ALLOWED_ORIGINS }), /ALLOWED_ORIGINS/);
  }
});

for (const transport of ["polling", "websocket"] as const) test(`production ${transport}: exact origin enforcement, health privacy, lobby and resume`, async t => {
  const origin = "https://play.example.com";
  const server = createOnlineServer({ connectionPolicy: readServerConfig({ NODE_ENV: "production", ALLOWED_ORIGINS: origin }) });
  const sockets: Socket<ServerEvents, ClientEvents>[] = [];
  t.after(async () => {
    sockets.forEach(s => s.disconnect());
    await new Promise<void>(resolve => server.io.close(() => resolve()));
  });
  server.http.listen(0, "127.0.0.1");
  await once(server.http, "listening");
  const url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  function client(requestOrigin?: string) {
    const socket: Socket<ServerEvents, ClientEvents> = io(url, {
      transports: [transport], reconnection: false, forceNew: true, autoConnect: false,
      ...(requestOrigin === undefined ? {} : { extraHeaders: { Origin: requestOrigin } }),
    });
    sockets.push(socket);
    return socket;
  }
  for (const denied of [undefined, "null", "https://evil.example.com", `${origin}.evil.example.com`, "http://play.example.com"]) {
    const socket = client(denied);
    const rejected = new Promise<void>((resolve, reject) => {
      socket.once("connect_error", () => resolve());
      socket.once("connect", () => reject(new Error("Disallowed origin connected")));
    });
    socket.connect();
    await rejected;
    socket.disconnect();
  }
  const response = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: origin } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  const rejected = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: "https://evil.example.com" } });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  for (const referer of [`${origin}/game`, "https://evil.example.com/game"]) {
    const sameOrigin = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
      headers: { "Sec-Fetch-Site": "same-origin", Referer: referer },
    });
    assert.equal(sameOrigin.status, referer.startsWith(origin) ? 200 : 403);
  }
  const preflight = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
    method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
  });
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert.match(preflight.headers.get("access-control-allow-methods")!, /POST/);
  const host = client(origin);
  const credentials = new Promise<Parameters<ServerEvents["room:session"]>[0]>(resolve => host.once("room:session", resolve));
  const connected = new Promise<void>((resolve, reject) => { host.once("connect", resolve); host.once("connect_error", reject); });
  host.connect(); await connected;
  assert.equal((await host.timeout(2000).emitWithAck("room:create-mode", "gostop", "예랑")).ok, true);
  assert.equal((await host.timeout(2000).emitWithAck("room:ready", true)).ok, true);
  const session = await credentials;
  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  host.disconnect();
  const fresh = client(origin);
  const resumed = new Promise<RoomView>(resolve => fresh.once("room:state", resolve));
  const freshConnected = new Promise<void>((resolve, reject) => { fresh.once("connect", resolve); fresh.once("connect_error", reject); });
  fresh.connect(); await freshConnected;
  assert.equal((await fresh.timeout(2000).emitWithAck("room:resume", session)).ok, true);
  const view = await resumed;
  assert.equal(view.connections[0].nickname, "예랑");
  assert.equal(view.connections[0].ready, true);
  assert.equal(view.host, 0);
  assert.ok(!JSON.stringify(view).includes(session.token));
});
