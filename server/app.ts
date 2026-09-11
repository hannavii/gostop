import express from "express";
import { createServer } from "node:http";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Server } from "socket.io";
import { NICKNAME_MAX_LENGTH } from "../shared/online";
import type { Ack, ClientEvents, ServerEvents, Seat } from "../shared/online";
import { applyAction, createMatch, gameView, parseAction, type Match } from "./game";
import { GAME_RULES, type GameMode } from "../src/game/rules";

export const RECONNECT_GRACE_MS = 60_000;
type Member = { nickname: string; ready: boolean; socketId: string | null; tokenHash: Buffer; deadline: number | null;
  timer: ReturnType<typeof setTimeout> | null };
type Room = { code: string; mode: GameMode; members: Member[]; host: Member | null; match: Match | null };
const hashToken = (token: string) => createHash("sha256").update(token).digest();

export function createOnlineServer({ reconnectGraceMs = RECONNECT_GRACE_MS, matchFactory = createMatch }: {
  reconnectGraceMs?: number; matchFactory?: typeof createMatch;
} = {}) {
  if (!Number.isSafeInteger(reconnectGraceMs) || reconnectGraceMs <= 0) throw new Error("Invalid reconnect grace period");
  const app = express();
  const http = createServer(app);
  const io = new Server<ClientEvents, ServerEvents>(http, { maxHttpBufferSize: 16_384 });
  const rooms = new Map<string, Room>();
  const membership = new Map<string, string>();
  app.get("/health", (_req, res) => { res.json({ ok: true }); });

  function publish(room: Room) {
    room.members.forEach((member, seat) => {
      if (!member.socketId) return;
      // Never broadcast raw Room/Match, even to members of the same room.
      io.to(member.socketId).emit("room:state", {
        code: room.code, you: seat as Seat, occupancy: room.members.length,
        host: room.members.indexOf(room.host!) as Seat,
        mode: room.mode, capacity: GAME_RULES[room.mode].playerCount,
        connections: room.members.map((m, i) => ({ seat: i as Seat, nickname: m.nickname, ready: m.ready, connected: m.socketId !== null, reconnectDeadline: m.deadline })),
        game: room.match ? gameView(room.match, seat as Seat) : null,
      });
    });
  }

  function closeRoom(room: Room, reason: string) {
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
    if (!room) throw new Error("방을 찾을 수 없습니다. 복구 시간이 지났거나 서버가 재시작되었을 수 있습니다.");
    for (const member of [...room.members]) {
      if (member.deadline !== null && member.deadline <= Date.now()) {
        removeMember(room, member, "재접속 대기 시간이 만료되었습니다.");
        if (!rooms.has(code)) throw new Error("재접속 대기 시간이 만료되었습니다.");
      }
    }
    return room;
  }

  function nickname(input: unknown) {
    if (typeof input !== "string") throw new Error("닉네임을 입력해주세요.");
    const value = input.trim();
    if (!value || value.length > NICKNAME_MAX_LENGTH || /[\p{Cc}\p{Cf}]/u.test(value)) {
      throw new Error(`닉네임은 1~${NICKNAME_MAX_LENGTH}자이며 제어 문자를 사용할 수 없습니다.`);
    }
    return value;
  }

  http.on("close", () => {
    for (const room of rooms.values()) for (const member of room.members) if (member.timer) clearTimeout(member.timer);
    rooms.clear(); membership.clear();
  });

  io.on("connection", socket => {
    function handle(ack: Ack, work: () => void) {
      // Malformed/missing acknowledgements must not crash or mutate the server.
      if (typeof ack !== "function") return;
      try {
        work();
        ack({ ok: true });
      } catch (error) {
        ack({ ok: false, error: error instanceof Error ? error.message : "요청 처리에 실패했습니다." });
      }
    }
    function currentRoom() {
      const code = membership.get(socket.id);
      if (!code) throw new Error("먼저 방을 만들거나 참가해주세요.");
      return activeRoom(code);
    }
    function requireLobby() {
      if (membership.has(socket.id)) throw new Error("이미 방에 참가 중입니다.");
    }
    function addMember(room: Room, name: string) {
      const token = randomBytes(32).toString("hex");
      room.members.push({ nickname: name, ready: false, socketId: socket.id, tokenHash: hashToken(token), deadline: null, timer: null });
      room.host ??= room.members[0];
      membership.set(socket.id, room.code);
      // Credentials go only to their owner, never in a public room snapshot.
      socket.emit("room:session", { roomCode: room.code, token });
    }
    function createRoom(mode: GameMode, input: string, ack: Ack) { handle(ack, () => {
      if (mode !== "matgo" && mode !== "gostop") throw new Error("지원하지 않는 게임 모드입니다.");
      requireLobby();
      const name = nickname(input);
      if (rooms.size >= 1000) throw new Error("현재 생성 가능한 방이 가득 찼습니다.");
      let code: string;
      do { code = randomInt(0, 36 ** 6).toString(36).toUpperCase().padStart(6, "0"); } while (rooms.has(code));
      const room: Room = { code, mode, members: [], host: null, match: null };
      rooms.set(code, room);
      addMember(room, name);
      publish(room);
    }); }
    // Both creation events require a validated nickname.
    socket.on("room:create", (name, ack) => createRoom("matgo", name, ack));
    socket.on("room:create-mode", (mode, name, ack) => createRoom(mode, name, ack));
    socket.on("room:join", (input, nameInput, ack) => handle(ack, () => {
      requireLobby();
      const name = nickname(nameInput);
      if (typeof input !== "string" || !/^[a-z0-9]{6}$/i.test(input)) throw new Error("방 코드는 영문·숫자 6자리입니다.");
      const code = input.toUpperCase();
      const room = activeRoom(code);
      const capacity = GAME_RULES[room.mode].playerCount;
      if (room.members.length >= capacity || room.match) throw new Error("방이 가득 찼습니다.");
      addMember(room, name);
      publish(room);
    }));
    socket.on("room:resume", (input, ack) => handle(ack, () => {
      if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some(key => key !== "roomCode" && key !== "token") ||
        typeof input.roomCode !== "string" || !/^[A-Z0-9]{6}$/.test(input.roomCode) ||
        typeof input.token !== "string" || !/^[a-f0-9]{64}$/.test(input.token)) {
        throw new Error("잘못된 재접속 요청입니다.");
      }
      const room = activeRoom(input.roomCode);
      const tokenHash = hashToken(input.token);
      const member = room.members.find(m => timingSafeEqual(m.tokenHash, tokenHash));
      if (!member) throw new Error("재접속 토큰을 확인할 수 없습니다.");
      // A socket already owning another seat cannot switch identities by resuming.
      if (membership.has(socket.id) && member.socketId !== socket.id) throw new Error("이미 다른 좌석에 참가 중입니다.");
      if (member.timer) clearTimeout(member.timer);
      if (member.socketId && member.socketId !== socket.id) {
        // F5 may arrive before the old transport times out. Revoke it atomically.
        const oldId = member.socketId;
        membership.delete(oldId);
        io.to(oldId).emit("room:closed", "다른 연결에서 같은 좌석을 복구했습니다.");
        io.sockets.sockets.get(oldId)?.disconnect(true);
      }
      member.socketId = socket.id;
      member.deadline = null; member.timer = null;
      membership.set(socket.id, room.code);
      // Stable token makes retries safe even if the previous acknowledgement was lost.
      socket.emit("room:session", { roomCode: room.code, token: input.token });
      publish(room);
    }));
    socket.on("room:ready", (ready, ack) => handle(ack, () => {
      const room = currentRoom();
      if (room.match || typeof ready !== "boolean") throw new Error("대기실에서 준비 여부를 선택해주세요.");
      room.members.find(m => m.socketId === socket.id)!.ready = ready;
      publish(room);
    }));
    socket.on("room:start", ack => handle(ack, () => {
      const room = currentRoom();
      if (room.host?.socketId !== socket.id) throw new Error("방장만 게임을 시작할 수 있습니다.");
      if (room.match) throw new Error("이미 시작한 게임입니다.");
      if (room.members.length !== GAME_RULES[room.mode].playerCount ||
        room.members.some(m => !m.socketId || !m.ready)) throw new Error("모든 인원이 접속하고 준비를 완료해야 합니다.");
      room.match = matchFactory(room.mode);
      publish(room);
    }));
    socket.on("room:leave", ack => handle(ack, () => {
      const room = currentRoom();
      removeMember(room, room.members.find(m => m.socketId === socket.id)!, "플레이어가 방을 나갔습니다.");
    }));
    socket.on("room:sync", ack => handle(ack, () => publish(currentRoom())));
    socket.on("game:action", (input, ack) => handle(ack, () => {
      const action = parseAction(input);
      const room = currentRoom();
      if (room.code !== action.roomCode) throw new Error("현재 참가한 방의 요청이 아닙니다.");
      if (!room.match) throw new Error("플레이어가 모두 참가하기를 기다리는 중입니다.");
      const seat = room.members.findIndex(m => m.socketId === socket.id);
      if (seat < 0 || seat >= GAME_RULES[room.mode].playerCount) throw new Error("방의 플레이어가 아닙니다.");
      room.match = applyAction(room.match, seat as Seat, action);
      publish(room);
    }));
    socket.on("disconnect", () => {
      const code = membership.get(socket.id);
      membership.delete(socket.id);
      const room = code ? rooms.get(code) : undefined;
      const member = room?.members.find(m => m.socketId === socket.id);
      if (!room || !member) return;
      member.socketId = null;
      member.deadline = Date.now() + reconnectGraceMs;
      member.timer = setTimeout(() => {
        if (rooms.get(room.code) === room && member.socketId === null) {
          removeMember(room, member, "재접속 대기 시간이 만료되었습니다.");
        }
      }, reconnectGraceMs);
      member.timer.unref();
      publish(room);
    });
  });
  return { http, io };
}
