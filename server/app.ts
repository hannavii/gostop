import { RequestError, REQUEST_FAILED, validateNickname, validateReconnect, validateRematch } from './validation';
import { TurnTimer } from "./turnTimer";
import { GameLog } from './gameLog';
import express from "express";
import { createServer } from "node:http";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Server } from "socket.io";
import type { Ack, ClientEvents, ServerEvents, Seat, Reply } from "../shared/online";
import { applyAction, createMatch, gameView, parseAction, type Match } from "./game";
import { GAME_RULES, type GameMode } from "../src/game/rules";
import { readServerConfig } from "./config";

export const RECONNECT_GRACE_MS = 60_000;
type Member = { nickname: string; ready: boolean; rematchReady: boolean; socketId: string | null; tokenHash: Buffer; deadline: number | null;
  timer: ReturnType<typeof setTimeout> | null };
type Room = { code: string; mode: GameMode; members: Member[]; host: Member | null; match: Match | null; round: number; turnTimer: TurnTimer; log: GameLog };
const hashToken = (token: string) => createHash("sha256").update(token).digest();

export function createOnlineServer({ reconnectGraceMs = RECONNECT_GRACE_MS, matchFactory = createMatch,
  turnTimerFactory = () => new TurnTimer(),
  connectionPolicy = readServerConfig() }: {
  reconnectGraceMs?: number; matchFactory?: typeof createMatch;
  turnTimerFactory?: () => TurnTimer;
  connectionPolicy?: Pick<ReturnType<typeof readServerConfig>, "allowedOrigins" | "allowMissingOrigin">;
} = {}) {
  if (!Number.isSafeInteger(reconnectGraceMs) || reconnectGraceMs <= 0) throw new Error("Invalid reconnect grace period");
  const app = express();
  const http = createServer(app);
  const originAllowed = (origin: string | undefined) => origin === undefined
    ? connectionPolicy.allowMissingOrigin : connectionPolicy.allowedOrigins.includes(origin);
  const io = new Server<ClientEvents, ServerEvents>(http, {
    maxHttpBufferSize: 16_384,
    cors: { origin: (origin, callback) => callback(null, originAllowed(origin)), methods: ["GET", "POST"] },
    // CORS alone does not restrict WebSocket handshakes.
    allowRequest: (request, callback) => {
      let origin = request.headers.origin;
      // Same-origin polling GETs may omit Origin; validate the browser's Referer instead.
      if (origin === undefined && request.headers["sec-fetch-site"] === "same-origin" && request.headers.referer) {
        try { origin = new URL(request.headers.referer).origin; } catch { /* deny below */ }
      }
      callback(null, originAllowed(origin));
    },
  });
  const rooms = new Map<string, Room>();
  const membership = new Map<string, string>();
  app.get("/health", (_req, res) => { res.json({ ok: true }); });

  function diagnose(operation: string, error: unknown) {
    // Fingerprints correlate failures without logging messages, stacks or credentials.
    console.error('[online-server] unexpected failure', { operation,
      kind: error instanceof TypeError ? 'TypeError' : error instanceof RangeError ? 'RangeError' : 'Error',
      fingerprint: createHash('sha256').update(error instanceof Error ? error.stack ?? error.message : typeof error).digest('hex').slice(0, 12) });
  }
  function background(room: Room, operation: string, work: () => void) {
    try { work(); } catch (error) {
      diagnose(operation, error);
      // A broken background transition must not leave a playable partial state.
      closeRoom(room, REQUEST_FAILED);
    }
  }

  function publish(room: Room) {
    room.turnTimer.sync(room.match, room.members.map(m => m.socketId !== null), () => {
      if (rooms.get(room.code) !== room) return;
      background(room, 'turn-timeout', () => {
        commitAction(room, room.match!.turn, room.turnTimer.fallback(room.match!, room.code), true);
        publish(room);
      });
    });
    room.members.forEach((member, seat) => {
      if (!member.socketId) return;
      // Never broadcast raw Room/Match, even to members of the same room.
      io.to(member.socketId).emit("room:state", {
        code: room.code, round: room.round, turnTimer: room.turnTimer.view, logs: room.log.entries, you: seat as Seat, occupancy: room.members.length,
        host: room.members.indexOf(room.host!) as Seat,
        mode: room.mode, capacity: GAME_RULES[room.mode].playerCount,
        connections: room.members.map((m, i) => ({ seat: i as Seat, nickname: m.nickname, ready: m.ready, rematchReady: m.rematchReady, connected: m.socketId !== null, reconnectDeadline: m.deadline })),
        game: room.match ? gameView(room.match, seat as Seat) : null,
      });
    });
  }

  function commitAction(room: Room, seat: Seat, action: Parameters<typeof applyAction>[2], automatic = false) {
    const before = room.match!;
    const after = applyAction(before, seat, action);
    const log = room.log.copy();
    log.action(before, after, seat, action, automatic);
    room.log = log;
    room.match = after;
  }

  function prepareRematch(room: Room, reconnecting?: Member) {
    if (room.match?.phase !== "finished" || room.members.length !== GAME_RULES[room.mode].playerCount ||
      room.members.some(member => !member.rematchReady || (!member.socketId && member !== reconnecting))) return;
    const match = matchFactory(room.mode);
    // Room-wide revision prevents an old game:action from matching a new deal.
    match.revision = room.match.revision + 1;
    return match;
  }
  function startRematch(room: Room, match = prepareRematch(room)) {
    if (!match) return;
    const log = room.log.copy();
    log.start(room.round + 1, match.revision);
    room.match = match;
    room.round++;
    room.log = log;
    room.members.forEach(member => { member.rematchReady = false; });
  }

  function closeRoom(room: Room, reason: string) {
    room.turnTimer.cancel();
    rooms.delete(room.code);
    for (const member of room.members) {
      if (member.timer) clearTimeout(member.timer);
      if (member.socketId) {
        membership.delete(member.socketId);
        io.to(member.socketId).emit("room:closed", reason);
      }
    }
  }

  function removeMember(room: Room, member: Member, reason: string) {
    // Active matches keep immutable seat indices and the existing termination policy.
    if (room.match) { closeRoom(room, reason); return; }
    if (member.timer) clearTimeout(member.timer);
    if (member.socketId) {
      membership.delete(member.socketId);
      io.to(member.socketId).emit("room:closed", reason);
    }
    room.members = room.members.filter(m => m !== member);
    if (!room.members.length) { rooms.delete(room.code); return; }
    if (room.host === member) room.host = room.members[0];
    publish(room);
  }

  function activeRoom(code: string) {
    const room = rooms.get(code);
    if (!room) throw new RequestError("방을 찾을 수 없습니다. 복구 시간이 지났거나 서버가 재시작되었을 수 있습니다.");
    for (const member of [...room.members]) {
      if (member.deadline !== null && member.deadline <= Date.now()) {
        removeMember(room, member, reconnectExpiryReason(room, member));
        if (!rooms.has(code)) throw new RequestError("재접속 대기 시간이 만료되었습니다.");
      }
    }
    return room;
  }

  function reconnectExpiryReason(room: Room, member: Member) {
    return room.match ? `${member.nickname}님의 재접속 대기 시간이 만료되어 방이 종료되었습니다.`
      : `${member.nickname}님의 재접속 대기 시간이 만료되었습니다.`;
  }

  http.on("close", () => {
    for (const room of rooms.values()) {
      room.turnTimer.cancel();
      for (const member of room.members) if (member.timer) clearTimeout(member.timer);
    }
    rooms.clear(); membership.clear();
  });

  io.on("connection", socket => {
    const arities = new Map<string, number>([
      ['room:create', 1], ['room:create-mode', 2], ['room:join', 2], ['room:resume', 1],
      ['room:ready', 1], ['room:start', 0], ['room:leave', 0], ['room:sync', 0],
      ['game:rematch', 1], ['game:action', 1],
    ]);
    // Socket.IO supplies the acknowledgement as the last argument. Reject extra
    // positional fields before the typed listeners can misinterpret that callback.
    socket.use(([event, ...args], next) => {
      const count = arities.get(event);
      if (count === undefined) { next(); return; }
      const ack = args.at(-1);
      if (typeof ack !== 'function') return;
      if (args.length !== count + 1) {
        handle(ack as Ack, 'request-shape', () => { throw new RequestError('잘못된 요청 형식입니다.'); });
        return;
      }
      next();
    });
    function handle(ack: Ack, operation: string, work: () => void) {
      // Malformed/missing acknowledgements must not crash or mutate the server.
      if (typeof ack !== "function") return;
      let reply: Reply;
      try { work(); reply = { ok: true }; } catch (error) {
        if (!(error instanceof RequestError)) diagnose(operation, error);
        reply = { ok: false, error: error instanceof RequestError ? error.message : REQUEST_FAILED };
      }
      try { ack(reply); } catch (error) { diagnose('acknowledgement', error); }
    }
    function currentRoom() {
      const code = membership.get(socket.id);
      if (!code) throw new RequestError("먼저 방을 만들거나 참가해주세요.");
      return activeRoom(code);
    }
    function requireLobby() {
      if (membership.has(socket.id)) throw new RequestError("이미 방에 참가 중입니다.");
    }
    function addMember(room: Room, name: string) {
      const token = randomBytes(32).toString("hex");
      room.members.push({ nickname: name, ready: false, rematchReady: false, socketId: socket.id, tokenHash: hashToken(token), deadline: null, timer: null });
      room.host ??= room.members[0];
      membership.set(socket.id, room.code);
      // Credentials go only to their owner, never in a public room snapshot.
      socket.emit("room:session", { roomCode: room.code, token });
    }
    function createRoom(mode: GameMode, input: string, ack: Ack) { handle(ack, 'room:create', () => {
      if (mode !== "matgo" && mode !== "gostop") throw new RequestError("지원하지 않는 게임 모드입니다.");
      requireLobby();
      const name = validateNickname(input);
      if (rooms.size >= 1000) throw new RequestError("현재 생성 가능한 방이 가득 찼습니다.");
      let code: string;
      do { code = randomInt(0, 36 ** 6).toString(36).toUpperCase().padStart(6, "0"); } while (rooms.has(code));
      const room: Room = { code, mode, members: [], host: null, match: null, round: 0, turnTimer: turnTimerFactory(), log: new GameLog(code) };
      rooms.set(code, room);
      addMember(room, name);
      publish(room);
    }); }
    // Both creation events require a validated nickname.
    socket.on("room:create", (name, ack) => createRoom("matgo", name, ack));
    socket.on("room:create-mode", (mode, name, ack) => createRoom(mode, name, ack));
    socket.on("room:join", (input, nameInput, ack) => handle(ack, 'room:join', () => {
      requireLobby();
      const name = validateNickname(nameInput);
      if (typeof input !== "string" || !/^[a-z0-9]{6}$/i.test(input)) throw new RequestError("방 코드는 영문·숫자 6자리입니다.");
      const code = input.toUpperCase();
      const room = activeRoom(code);
      const capacity = GAME_RULES[room.mode].playerCount;
      if (room.members.length >= capacity || room.match) throw new RequestError("방이 가득 찼습니다.");
      addMember(room, name);
      publish(room);
    }));
    socket.on("room:resume", (input, ack) => handle(ack, 'room:resume', () => {
      input = validateReconnect(input);
      const room = activeRoom(input.roomCode);
      const tokenHash = hashToken(input.token);
      const member = room.members.find(m => timingSafeEqual(m.tokenHash, tokenHash));
      if (!member) throw new RequestError("재접속 토큰을 확인할 수 없습니다.");
      // A socket already owning another seat cannot switch identities by resuming.
      if (membership.has(socket.id) && member.socketId !== socket.id) throw new RequestError("이미 다른 좌석에 참가 중입니다.");
      const reconnecting = member.socketId !== socket.id;
      // Prepare a unanimous rematch before revoking the previous transport.
      const nextMatch = prepareRematch(room, member);
      if (member.timer) clearTimeout(member.timer);
      if (member.socketId && member.socketId !== socket.id) {
        // F5 may arrive before the old transport times out. Revoke it atomically.
        const oldId = member.socketId;
        membership.delete(oldId);
        io.to(oldId).emit("room:closed", "다른 연결에서 같은 좌석을 복구했습니다.");
        io.sockets.sockets.get(oldId)?.disconnect(true);
      }
      if (reconnecting && room.match?.turn === room.members.indexOf(member)) room.turnTimer.cancel();
      member.socketId = socket.id;
      member.deadline = null; member.timer = null;
      membership.set(socket.id, room.code);
      // Stable token makes retries safe even if the previous acknowledgement was lost.
      socket.emit("room:session", { roomCode: room.code, token: input.token });
      if (reconnecting && room.match) room.log.append(room.match.revision, {
        type: 'reconnect', playerSeat: room.members.indexOf(member) as Seat, payload: {},
      });
      if (nextMatch) startRematch(room, nextMatch);
      publish(room);
    }));
    socket.on("room:ready", (ready, ack) => handle(ack, 'room:ready', () => {
      const room = currentRoom();
      if (room.match || typeof ready !== "boolean") throw new RequestError("대기실에서 준비 여부를 선택해주세요.");
      room.members.find(m => m.socketId === socket.id)!.ready = ready;
      publish(room);
    }));
    socket.on("room:start", ack => handle(ack, 'room:start', () => {
      const room = currentRoom();
      if (room.host?.socketId !== socket.id) throw new RequestError("방장만 게임을 시작할 수 있습니다.");
      if (room.match) throw new RequestError("이미 시작한 게임입니다.");
      if (room.members.length !== GAME_RULES[room.mode].playerCount ||
        room.members.some(m => !m.socketId || !m.ready)) throw new RequestError("모든 인원이 접속하고 준비를 완료해야 합니다.");
      const match = matchFactory(room.mode);
      const log = room.log.copy();
      log.start(room.round + 1, match.revision);
      room.match = match;
      room.round++;
      room.log = log;
      publish(room);
    }));
    socket.on("room:leave", ack => handle(ack, 'room:leave', () => {
      const room = currentRoom();
      removeMember(room, room.members.find(m => m.socketId === socket.id)!, "플레이어가 방을 나갔습니다.");
    }));
    socket.on("room:sync", ack => handle(ack, 'room:sync', () => publish(currentRoom())));
    socket.on("game:rematch", (input, ack) => handle(ack, 'game:rematch', () => {
      input = validateRematch(input);
      const room = currentRoom();
      if (room.code !== input.roomCode || room.round !== input.round) throw new RequestError("지난 판의 다시하기 요청입니다.");
      if (room.match?.phase !== "finished") throw new RequestError("게임 종료 후 다시하기를 선택해주세요.");
      const member = room.members.find(m => m.socketId === socket.id)!;
      const previous = member.rematchReady;
      member.rematchReady = input.ready;
      try { startRematch(room); } catch (error) { member.rematchReady = previous; throw error; }
      publish(room);
    }));
    socket.on("game:action", (input, ack) => handle(ack, 'game:action', () => {
      const action = parseAction(input);
      const room = currentRoom();
      if (room.code !== action.roomCode) throw new RequestError("현재 참가한 방의 요청이 아닙니다.");
      if (action.round !== undefined && action.round !== room.round) throw new RequestError("지난 판의 행동 요청입니다.");
      if (!room.match) throw new RequestError("플레이어가 모두 참가하기를 기다리는 중입니다.");
      const seat = room.members.findIndex(m => m.socketId === socket.id);
      if (seat < 0 || seat >= GAME_RULES[room.mode].playerCount) throw new RequestError("방의 플레이어가 아닙니다.");
      commitAction(room, seat as Seat, action);
      publish(room);
    }));
    socket.on("disconnect", () => {
      const code = membership.get(socket.id);
      membership.delete(socket.id);
      const room = code ? rooms.get(code) : undefined;
      const member = room?.members.find(m => m.socketId === socket.id);
      if (!room || !member) return;
      background(room, 'disconnect', () => {
        member.socketId = null;
        if (room.match) room.log.append(room.match.revision, {
          type: 'disconnect', playerSeat: room.members.indexOf(member) as Seat, payload: {},
        });
        member.deadline = Date.now() + reconnectGraceMs;
        const timer = setTimeout(() => {
          if (rooms.get(room.code) === room && member.socketId === null && member.timer === timer) {
            background(room, 'reconnect-expiry', () => removeMember(room, member, reconnectExpiryReason(room, member)));
          }
        }, reconnectGraceMs);
        member.timer = timer;
        member.timer.unref();
        publish(room);
      });
    });
  });
  return { http, io };
}
