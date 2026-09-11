import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import OnlineGameBoard from "./OnlineGameBoard";
import type { ClientEvents, GameAction, Reply, RoomView, ServerEvents } from "../../shared/online";
import "./online.css";
import type { GameMode } from "../game/rules";
import { clearReconnectSession, readReconnectSession, saveReconnectSession } from "./reconnectSession";

type OnlineSocket = Socket<ServerEvents, ClientEvents>;
export default function OnlineMatgo({ onBack }: { onBack: () => void }) {
  const socketRef = useRef<OnlineSocket | null>(null);
  const sending = useRef(false);
  const sessionRef = useRef(readReconnectSession());
  const [connected, setConnected] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<GameMode>("matgo");
  const [message, setMessage] = useState("서버에 연결하는 중입니다.");

  useEffect(() => {
    const socket: OnlineSocket = io({ autoConnect: false });
    socketRef.current = socket;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    async function restore() {
      const session = sessionRef.current;
      if (!session || !socket.connected || disposed) return;
      const connectionId = socket.id;
      setRestoring(true);
      setMessage("기존 방과 좌석을 복구하는 중입니다.");
      try {
        const reply = await socket.timeout(5000).emitWithAck("room:resume", session);
        if (disposed || !socket.connected || socket.id !== connectionId) return;
        setRestoring(false);
        if (!reply.ok) {
          sessionRef.current = null;
          clearReconnectSession();
          setRoom(null);
          setMessage(reply.error);
        }
      } catch {
        if (disposed || !socket.connected || socket.id !== connectionId) return;
        setMessage("복구 응답을 기다리고 있습니다. 다시 시도합니다.");
        retry = setTimeout(() => void restore(), 1000);
      }
    }
    socket.on("connect", () => {
      setConnected(true);
      if (sessionRef.current) void restore();
      else { setRestoring(false); setMessage("방을 만들거나 방 코드로 참가하세요."); }
    });
    socket.on("disconnect", reason => {
      clearTimeout(retry);
      setConnected(false);
      sending.current = false;
      setBusy(false);
      setRestoring(false);
      if (reason !== "io server disconnect") setMessage("연결이 끊겼습니다. 재연결되면 같은 좌석으로 복구합니다.");
    });
    socket.on("connect_error", () => {
      setMessage("서버에 연결할 수 없습니다. 서버 실행 상태를 확인해주세요.");
    });
    socket.on("room:state", view => { setRoom(view); setMessage(""); });
    socket.on("room:session", session => {
      sessionRef.current = session;
      setStorageWarning(saveReconnectSession(session) ? "" : "브라우저 저장소를 사용할 수 없어 새로고침 복구가 불가능합니다.");
    });
    socket.on("room:closed", reason => {
      clearTimeout(retry);
      sessionRef.current = null;
      clearReconnectSession();
      setRestoring(false); setStorageWarning(""); setRoom(null); setMessage(reason);
    });
    socket.connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  async function request(work: (socket: OnlineSocket) => Promise<Reply>) {
    const socket = socketRef.current;
    if (!socket?.connected || sending.current || restoring) return;
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
  const enabled = connected && !busy && !restoring;
  const offline = room?.connections.filter(c => !c.connected) ?? [];
  const connectionMessage = room && offline.length ? `${offline.map(c => c.seat === room.you ? "나" : room.mode === "gostop" ? `상대 ${(c.seat - room.you + 3) % 3}` : "상대방").join(", ")} 재접속 대기 중 · 해당 플레이어의 차례는 복귀할 때까지 기다립니다.` : "";
  const displayedMessage = message || storageWarning || connectionMessage;
  if (room && game) return <OnlineGameBoard key={room.code} room={room} game={game}
    enabled={enabled} message={displayedMessage} act={act}
    onSync={() => void request(s => s.timeout(5000).emitWithAck("room:sync"))}
    onLeave={() => void request(s => s.timeout(5000).emitWithAck("room:leave"))} />;

  return (
    <main className="online-page">
      <header className="online-header">
        <button type="button" disabled={busy || restoring || !!room && !connected} onClick={() => {
          if (!room) onBack();
          else void request(async s => {
            const reply = await s.timeout(5000).emitWithAck("room:leave");
            if (reply.ok) onBack();
            return reply;
          });
        }}>← 게임 선택</button>
        <h1>온라인 맞고 / 고스톱</h1>
        <span>{connected ? "연결됨" : "연결 중"}</span>
      </header>
      {displayedMessage && <p className="online-message" role="status">{displayedMessage}</p>}
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
          <p>같은 탭에서 새로고침하거나 일시적으로 연결이 끊겨도 60초 안에 같은 좌석으로 복구할 수 있습니다. 방 나가기는 방을 종료합니다.</p>
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
