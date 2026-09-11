import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import OnlineGameBoard from "./OnlineGameBoard";
import type { ClientEvents, GameAction, Reply, RoomView, ServerEvents } from "../../shared/online";
import "./online.css";
import type { GameMode } from "../game/rules";

type OnlineSocket = Socket<ServerEvents, ClientEvents>;
export default function OnlineMatgo({ onBack }: { onBack: () => void }) {
  const socketRef = useRef<OnlineSocket | null>(null);
  const sending = useRef(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<GameMode>("matgo");
  const [message, setMessage] = useState("서버에 연결하는 중입니다.");

  useEffect(() => {
    const socket: OnlineSocket = io({ autoConnect: false });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      setMessage("방을 만들거나 방 코드로 참가하세요.");
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setRoom(null);
      sending.current = false;
      setBusy(false);
      setMessage("연결이 끊겼습니다. 재연결 후 새 방을 만들어주세요.");
    });
    socket.on("connect_error", () => {
      setMessage("서버에 연결할 수 없습니다. 서버 실행 상태를 확인해주세요.");
    });
    socket.on("room:state", view => { setRoom(view); setMessage(""); });
    socket.on("room:closed", reason => { setRoom(null); setMessage(reason); });
    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  async function request(work: (socket: OnlineSocket) => Promise<Reply>) {
    const socket = socketRef.current;
    if (!socket?.connected || sending.current) return;
    const connectionId = socket.id;
    sending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const reply = await work(socket);
      if (socket.id === connectionId && !reply.ok) setMessage(reply.error);
    } catch {
      if (socket.id === connectionId) setMessage("응답을 확인하지 못했습니다. 방 상태를 새로고침해주세요.");
    } finally {
      if (socketRef.current === socket && socket.id === connectionId) {
        sending.current = false;
        setBusy(false);
      }
    }
  }

  function act(type: GameAction["type"], cardId?: string) {
    if (!room?.game) return;
    const action: GameAction = { roomCode: room.code, revision: room.game.revision, type };
    if (cardId !== undefined) action.cardId = cardId;
    void request(s => s.timeout(5000).emitWithAck("game:action", action));
  }

  const game = room?.game;
  const enabled = connected && !busy;
  if (room && game) return <OnlineGameBoard key={room.code} room={room} game={game}
    enabled={enabled} message={message} act={act}
    onSync={() => void request(s => s.timeout(5000).emitWithAck("room:sync"))}
    onLeave={() => void request(s => s.timeout(5000).emitWithAck("room:leave"))} />;

  return (
    <main className="online-page">
      <header className="online-header">
        <button type="button" onClick={onBack}>← 게임 선택</button>
        <h1>온라인 맞고 / 고스톱</h1>
        <span>{connected ? "연결됨" : "연결 중"}</span>
      </header>
      {message && <p className="online-message" role="status">{message}</p>}
      {!room ? (
        <section className="online-lobby">
          <h2>친구와 함께 맞고 / 고스톱</h2>
          <p>방을 만들고 표시되는 6자리 코드를 상대방에게 알려주세요.</p>
          <label htmlFor="online-mode">게임 모드 </label>
          <select id="online-mode" value={mode} disabled={!enabled} onChange={event => setMode(event.target.value as GameMode)}>
            <option value="matgo">2인 맞고</option><option value="gostop">3인 고스톱</option>
          </select>
          <button type="button" disabled={!enabled}
            onClick={() => void request(s => s.timeout(5000).emitWithAck("room:create-mode", mode))}>방 만들기</button>
          <form onSubmit={event => {
            event.preventDefault();
            void request(s => s.timeout(5000).emitWithAck("room:join", code.trim().toUpperCase()));
          }}>
            <label htmlFor="online-room-code">방 코드</label>
            <input id="online-room-code" value={code} maxLength={6} autoComplete="off"
              onChange={event => setCode(event.target.value.toUpperCase())} placeholder="6자리 코드" />
            <button disabled={!enabled || !/^[A-Z0-9]{6}$/.test(code.trim())}>참가하기</button>
          </form>
          <p>첫 버전에서는 연결이 끊기거나 새로고침하면 방이 종료됩니다.</p>
        </section>
      ) : (
        <>
          <nav className="online-room-bar" aria-label="방 정보">
            <strong>방 코드: <span className="online-code">{room.code}</span></strong>
            <span>{room.mode === "gostop" ? "3인 고스톱" : "2인 맞고"} · {room.occupancy}/{room.capacity}명</span>
            <button type="button" disabled={!enabled}
              onClick={() => void request(s => s.timeout(5000).emitWithAck("room:sync"))}>상태 새로고침</button>
            <button type="button" disabled={!enabled}
              onClick={() => void request(s => s.timeout(5000).emitWithAck("room:leave"))}>방 나가기</button>
          </nav>
          <p className="online-waiting">상대방을 기다립니다. {room.capacity}명이 모이면 자동으로 시작합니다.</p>
        </>
      )}
    </main>
  );
}
