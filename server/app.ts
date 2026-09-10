import express from "express";
import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { Server } from "socket.io";
import type { Ack, ClientEvents, ServerEvents, Seat } from "../shared/online";
import { applyAction, createMatch, gameView, parseAction, type Match } from "./game";

type Room = { code: string; members: string[]; match: Match | null };

export function createOnlineServer() {
  const app = express();
  const http = createServer(app);
  const io = new Server<ClientEvents, ServerEvents>(http, { maxHttpBufferSize: 16_384 });
  const rooms = new Map<string, Room>();
  const membership = new Map<string, string>();
  app.get("/health", (_req, res) => { res.json({ ok: true }); });

  function publish(room: Room) {
    room.members.forEach((id, seat) => {
      // Never broadcast raw Room/Match, even to members of the same room.
      io.to(id).emit("room:state", {
        code: room.code, you: seat as Seat, occupancy: room.members.length,
        game: room.match ? gameView(room.match, seat as Seat) : null,
      });
    });
  }

  function leave(id: string) {
    const code = membership.get(id);
    const room = code ? rooms.get(code) : undefined;
    if (!room) return;
    rooms.delete(room.code);
    for (const member of room.members) {
      membership.delete(member);
      io.to(member).emit("room:closed", "플레이어가 나갔거나 연결이 끊겨 방이 종료되었습니다. 새 방을 만들어주세요.");
    }
  }

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
      const room = code ? rooms.get(code) : undefined;
      if (!room) throw new Error("먼저 방을 만들거나 참가해주세요.");
      return room;
    }
    function requireLobby() {
      if (membership.has(socket.id)) throw new Error("이미 방에 참가 중입니다.");
    }
    socket.on("room:create", ack => handle(ack, () => {
      requireLobby();
      if (rooms.size >= 1000) throw new Error("현재 생성 가능한 방이 가득 찼습니다.");
      let code: string;
      do { code = randomInt(0, 36 ** 6).toString(36).toUpperCase().padStart(6, "0"); } while (rooms.has(code));
      const room: Room = { code, members: [socket.id], match: null };
      rooms.set(code, room);
      membership.set(socket.id, code);
      publish(room);
    }));
    socket.on("room:join", (input, ack) => handle(ack, () => {
      requireLobby();
      if (typeof input !== "string" || !/^[a-z0-9]{6}$/i.test(input)) throw new Error("방 코드는 영문·숫자 6자리입니다.");
      const code = input.toUpperCase();
      const room = rooms.get(code);
      if (!room) throw new Error("방을 찾을 수 없습니다.");
      if (room.members.length !== 1 || room.match) throw new Error("이미 두 명이 참가한 방입니다.");
      const match = createMatch();
      room.members.push(socket.id);
      membership.set(socket.id, code);
      room.match = match;
      publish(room);
    }));
    socket.on("room:leave", ack => handle(ack, () => leave(socket.id)));
    socket.on("room:sync", ack => handle(ack, () => publish(currentRoom())));
    socket.on("game:action", (input, ack) => handle(ack, () => {
      const action = parseAction(input);
      const room = currentRoom();
      if (room.code !== action.roomCode) throw new Error("현재 참가한 방의 요청이 아닙니다.");
      if (!room.match) throw new Error("두 번째 플레이어를 기다리는 중입니다.");
      const seat = room.members.indexOf(socket.id);
      if (seat !== 0 && seat !== 1) throw new Error("방의 플레이어가 아닙니다.");
      room.match = applyAction(room.match, seat, action);
      publish(room);
    }));
    socket.on("disconnect", () => leave(socket.id));
  });
  return { http, io };
}
