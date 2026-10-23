import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { createOnlineServer } from '../app';
import { RoomChat } from '../chat';
import { QUICK_CHAT_PRESETS } from '../../src/online/quickChat';
import { validateChat } from '../validation';
import { CHAT_COOLDOWN_MS, MAX_CHAT_HISTORY, MAX_CHAT_MESSAGE_LENGTH, type ChatState, type ClientEvents, type ServerEvents, type ReconnectSession, type RoomView, type Reply } from '../../shared/online';

test('chat validation rejects malformed, forged, Unicode and control input; HTML stays text', () => {
  for (const { text } of QUICK_CHAT_PRESETS) assert.equal(validateChat({ roomCode: 'ABC123', message: text }).message, text);
  for (const input of [null, [], 2, 'text', {}, { roomCode: 'ABC123' },
    ...[null, {}, [], 1, '', '  ', 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1), '😀'.repeat(101), '\ntext', '\u0000', '\u202etext'].map(message => ({ roomCode: 'ABC123', message })),
    ...['nickname', 'seat', 'role', 'createdAt', 'type', '__proto__'].map(key => JSON.parse(`{"roomCode":"ABC123","message":"hi","${key}":"fake"}`)),
    { roomCode: 'abc123', message: 'hi' }, new Date(), Object.create({ message: 'hi' })]) assert.throws(() => validateChat(input));
  const html = '<script>alert(1)</script>';
  assert.equal(validateChat({ roomCode: 'ABC123', message: `  ${html}  ` }).message, html);
  assert.equal(validateChat({ roomCode: 'ABC123', message: '가'.repeat(200) }).message.length, 200);
  assert.equal(validateChat({ roomCode: 'ABC123', message: '👩‍💻' }).message, '👩‍💻');
});

test('room history has unique ordered public records and a fixed cap', () => {
  const chat = new RoomChat();
  chat.system('A', 'join');
  for (let i = 0; i < 110; i++) chat.user({ role: 'player', seat: 0, nickname: 'A' }, String(i));
  assert.equal(chat.messages.length, MAX_CHAT_HISTORY);
  assert.equal(new Set(chat.messages.map(m => m.id)).size, MAX_CHAT_HISTORY);
  assert.deepEqual(chat.messages.map(m => m.text), Array.from({ length: 100 }, (_, i) => String(i + 10)));
  assert.ok(chat.messages.every(m => Number.isFinite(Date.parse(m.createdAt))));
  assert.doesNotMatch(JSON.stringify(chat.messages), /token|socketId|hand|pending|timer/);
});

test('real sockets: isolation, authority, spam, spectator, reconnect and game invariants', async t => {
  const server = createOnlineServer();
  const clients: Socket<ServerEvents, ClientEvents>[] = [];
  t.after(async () => { clients.forEach(c => c.disconnect()); await new Promise<void>(r => server.io.close(() => r())); });
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
  const url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  async function peer() {
    const socket: Socket<ServerEvents, ClientEvents> = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(socket);
    const state = { chat: null as ChatState | null, view: null as RoomView | null, session: null as ReconnectSession | null, deliveries: 0, games: 0 };
    socket.on('chat:state', v => { state.chat = v; state.deliveries++; });
    socket.on('room:state', v => { state.view = v; state.games++; });
    socket.on('room:session', v => { state.session = v; });
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return { socket, state };
  }
  const a = await peer(), b = await peer(), foreign = await peer(), outsider = await peer();
  await a.socket.emitWithAck('room:create', 'Alice');
  const code = a.state.view!.code;
  await b.socket.emitWithAck('room:join', code, 'Bob');
  await foreign.socket.emitWithAck('room:create', 'Other');
  const foreignBefore = structuredClone(foreign.state.chat), deliveries = foreign.state.deliveries;
  const outsiderReply = await outsider.socket.emitWithAck('chat:send', { roomCode: code, message: 'intrude' });
  const foreignReply = await foreign.socket.emitWithAck('chat:send', { roomCode: code, message: 'intrude' });
  assert.equal(outsiderReply.ok, false); assert.deepEqual(outsiderReply, foreignReply);
  assert.equal((await a.socket.emitWithAck('chat:send', { roomCode: code, message: '<script>alert(1)</script>' })).ok, true);
  await b.socket.emitWithAck('room:sync');
  assert.deepEqual(a.state.chat, b.state.chat);
  const sent = b.state.chat!.messages.at(-1)!;
  assert.equal(sent.type, 'user');
  if (sent.type === 'user') assert.deepEqual(sent.sender, { nickname: 'Alice', role: 'player', seat: 0 });
  assert.equal(sent.text, '<script>alert(1)</script>');
  for (const { text } of QUICK_CHAT_PRESETS) {
    assert.equal((await a.socket.emitWithAck('chat:send', { roomCode: code, message: text })).ok, false);
  }
  assert.equal((await b.socket.emitWithAck('chat:send', { roomCode: code, message: 'reply' })).ok, true);
  await a.socket.emitWithAck('room:ready', true); await b.socket.emitWithAck('room:ready', true); await a.socket.emitWithAck('room:start');
  const spectator = await peer();
  await spectator.socket.emitWithAck('room:spectate', { roomCode: code });
  const gameBefore = structuredClone(a.state.view), gamePackets = a.state.games;
  assert.equal((await spectator.socket.emitWithAck('chat:send', { roomCode: code, message: '👍' })).ok, true);
  // Barrier from this same server connection; chat never publishes a game snapshot.
  await spectator.socket.emitWithAck('room:list');
  assert.deepEqual(a.state.view, gameBefore); assert.equal(a.state.games, gamePackets);
  assert.equal((await spectator.socket.emitWithAck('room:ready', true)).ok, false);
  const last = spectator.state.chat!.messages.at(-1)!;
  if (last.type === 'user') assert.deepEqual(last.sender, { nickname: '관전자 1', role: 'spectator' }); else assert.fail('missing user message');
  const session = b.state.session!;
  const restored = await peer();
  await restored.socket.emitWithAck('room:resume', session);
  const reconnects = restored.state.chat!.messages.filter(m => m.type === 'system' && m.event === 'reconnect').length;
  await restored.socket.emitWithAck('room:resume', session);
  assert.equal(restored.state.chat!.messages.filter(m => m.type === 'system' && m.event === 'reconnect').length, reconnects);
  assert.ok(restored.state.chat!.messages.some(m => m.text === 'reply'));
  const watcherReplacement = await peer();
  const spectatorSession = { roomCode: code, token: spectator.state.session!.token };
  await watcherReplacement.socket.emitWithAck('room:spectator-resume', spectatorSession);
  const count = watcherReplacement.state.chat!.messages.length;
  await watcherReplacement.socket.emitWithAck('room:spectator-resume', spectatorSession);
  assert.equal(watcherReplacement.state.chat!.messages.length, count);
  await watcherReplacement.socket.emitWithAck('room:leave');
  await a.socket.emitWithAck('room:sync');
  assert.ok(a.state.chat!.messages.some(m => m.type === 'system' && m.event === 'leave' && m.text.includes('관전자')));
  assert.equal(foreign.state.deliveries, deliveries); assert.deepEqual(foreign.state.chat, foreignBefore);
  assert.equal(outsider.state.chat, null);
  await new Promise(r => setTimeout(r, CHAT_COOLDOWN_MS));
  assert.equal((await a.socket.emitWithAck('chat:send', { roomCode: code, message: 'later' })).ok, true);
  await restored.socket.emitWithAck('room:leave'); // existing active-room closure policy
  assert.equal((await a.socket.emitWithAck('chat:send', { roomCode: code, message: 'deleted' })).ok, false);
  await a.socket.emitWithAck('room:create', 'New');
  assert.equal(a.state.chat!.messages.length, 1);
  // Exercise malicious payloads against the transport, not only the pure validator.
  for (const payload of [{ roomCode: a.state.view!.code, message: {} }, { roomCode: a.state.view!.code, message: 'x'.repeat(4000) },
    ...['nickname', 'role', 'seat', 'createdAt'].map(key => ({ roomCode: a.state.view!.code, message: 'forged', [key]: 'fake' }))]) {
    const reply = await new Promise<Reply>(resolve => (a.socket as unknown as { emit: (event: string, payload: unknown, ack: (r: Reply) => void) => void }).emit('chat:send', payload, resolve));
    assert.equal(reply.ok, false);
  }
  assert.equal(a.state.chat!.messages.length, 1);
});

test('disconnect, grace expiry and lobby leave are distinct, spectator expiry is lazy and once', async t => {
  const server = createOnlineServer({ reconnectGraceMs: 120 });
  const clients: Socket<ServerEvents, ClientEvents>[] = [];
  t.after(async () => { clients.forEach(c => c.disconnect()); await new Promise<void>(r => server.io.close(() => r())); });
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
  const url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  async function connect() { const c: Socket<ServerEvents, ClientEvents> = io(url, { transports: ['websocket'], reconnection: false }); clients.push(c); await new Promise<void>((resolve, reject) => { c.once('connect', resolve); c.once('connect_error', reject); }); return c; }
  const a = await connect(), b = await connect();
  let view!: RoomView, chat!: ChatState;
  a.on('room:state', v => { view = v; }); a.on('chat:state', v => { chat = v; });
  await a.emitWithAck('room:create', 'A'); await b.emitWithAck('room:join', view.code, 'B');
  b.disconnect();
  await new Promise(r => setTimeout(r, 200)); await a.emitWithAck('room:sync');
  assert.equal(chat.messages.filter(m => m.type === 'system' && m.event === 'disconnect').length, 1);
  assert.equal(chat.messages.filter(m => m.type === 'system' && m.event === 'leave').length, 1);
  const c = await connect(); await c.emitWithAck('room:join', view.code, 'C'); await c.emitWithAck('room:leave');
  await a.emitWithAck('room:sync');
  assert.equal(chat.messages.filter(m => m.type === 'system' && m.event === 'leave').length, 2);
  const d = await connect(); await d.emitWithAck('room:join', view.code, 'D');
  await a.emitWithAck('room:ready', true); await d.emitWithAck('room:ready', true); await a.emitWithAck('room:start');
  const watcher = await connect(); await watcher.emitWithAck('room:spectate', { roomCode: view.code }); watcher.disconnect();
  await new Promise(r => setTimeout(r, 200)); await a.emitWithAck('room:sync');
  const leaves = chat.messages.filter(m => m.type === 'system' && m.event === 'leave').length;
  assert.equal(leaves, 3);
  await a.emitWithAck('room:sync');
  assert.equal(chat.messages.filter(m => m.type === 'system' && m.event === 'leave').length, leaves);
});
