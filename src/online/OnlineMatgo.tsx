import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import Card from "../components/Card";
import type { ClientEvents, GameAction, Reply, RoomView, ServerEvents } from "../../shared/online";
import "./online.css";

type OnlineSocket = Socket<ServerEvents, ClientEvents>;
const eventNames: Record<string, string> = {
  ppeok: "뻑!", jjok: "쪽!", ttadak: "따닥!", pansseul: "판쓸!",
  "ppeok-capture": "뻑 먹기!", "self-ppeok-capture": "자뻑 회수!",
};

export default function OnlineMatgo({ onBack }: { onBack: () => void }) {
  const socketRef = useRef<OnlineSocket | null>(null);
  const sending = useRef(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [code, setCode] = useState("");
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
  const mine = game && room ? game.players[room.you] : null;
  const opponent = game && room ? game.players[room.you === 0 ? 1 : 0] : null;
  const myTurn = Boolean(game && room && game.turn === room.you);
  const enabled = connected && !busy;
  const resultLabel = !game?.result ? "" : game.result.winner === "draw"
    ? "나가리 · 무승부" : game.result.winner === room?.you ? "승리!" : "상대방 승리";

  return (
    <main className="online-page">
      <header className="online-header">
        <button type="button" onClick={onBack}>← 게임 선택</button>
        <h1>온라인 2인 맞고</h1>
        <span>{connected ? "연결됨" : "연결 중"}</span>
      </header>
      {message && <p className="online-message" role="status">{message}</p>}
      {!room ? (
        <section className="online-lobby">
          <h2>친구와 함께 맞고</h2>
          <p>방을 만들고 표시되는 6자리 코드를 상대방에게 알려주세요.</p>
          <button type="button" disabled={!enabled}
            onClick={() => void request(s => s.timeout(5000).emitWithAck("room:create"))}>방 만들기</button>
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
            <span>{room.occupancy}/2명</span>
            <button type="button" disabled={!enabled}
              onClick={() => void request(s => s.timeout(5000).emitWithAck("room:sync"))}>상태 새로고침</button>
            <button type="button" disabled={!enabled}
              onClick={() => void request(s => s.timeout(5000).emitWithAck("room:leave"))}>방 나가기</button>
          </nav>
          {!game ? <p className="online-waiting">상대방을 기다립니다. 두 명이 모이면 자동으로 시작합니다.</p> : (
            <div className="online-board">
              <section>
                <h2>상대 · {opponent?.score}점 · {opponent?.goCount}고 · 손패 {opponent?.handCount}장</h2>
                <div className="online-cards" aria-label="상대 손패">
                  {Array.from({ length: opponent?.handCount ?? 0 }, (_, i) => <Card key={i} isBack />)}
                </div>
              </section>
              <section className="online-table">
                <h2>{game.phase === "finished" ? resultLabel : myTurn ? "내 차례" : "상대방 차례"}</h2>
                <p>더미 {game.drawCount}장 · 바닥 {game.floor.length}장 · 상태 #{game.revision}</p>
                {game.specialEvents.length > 0 && <p className="online-events" role="status">
                  {game.specialEvents.map(event => eventNames[event] ?? event).join(" + ")}
                </p>}
                <div className="online-cards" aria-label="바닥패">
                  {game.floor.map(card => <Card key={card.id} card={card} />)}
                  {game.floor.length === 0 && <span>바닥에 패가 없습니다.</span>}
                </div>
                {game.ppeokStacks.length > 0 && <p>뻑 묶음: {game.ppeokStacks.map(stack => `${stack.month}월`).join(", ")}</p>}
                {game.revealed.length > 0 && <details open>
                  <summary>이번 턴에 공개된 패 (손패 → 더미패)</summary>
                  <div className="online-cards">{game.revealed.map(card => <Card key={card.id} card={card} />)}</div>
                </details>}
                {game.phase === "choose" && <div className="online-prompt">
                  <p>{myTurn ? "가져갈 바닥패를 선택하세요." : "상대방이 바닥패를 선택하고 있습니다."}</p>
                  <div className="online-cards">{game.choice?.map(card => (
                    <Card key={card.id} card={card} isSelectable={enabled}
                      onClick={enabled && myTurn ? () => act("choose", card.id) : undefined} />
                  ))}</div>
                </div>}
                {game.phase === "go-stop" && <div className="online-prompt">
                  <p>{myTurn ? "GO 또는 STOP을 선택하세요." : "상대방이 GO/STOP을 선택하고 있습니다."}</p>
                  {myTurn && <>
                    <button type="button" disabled={!enabled} onClick={() => act("go")}>GO</button>
                    <button type="button" disabled={!enabled} onClick={() => act("stop")}>STOP</button>
                  </>}
                </div>}
                {game.result?.settlement && <p>기본 {game.result.settlement.baseScore}점 + 고 보너스 {game.result.settlement.goBonus}점
                  · {game.result.settlement.totalMultiplier}배 · 최종 {game.result.settlement.finalScore}점</p>}
                {game.phase === "finished" && <p>다시 플레이하려면 방을 나간 뒤 새 방을 만들어주세요.</p>}
              </section>
              <section>
                <h2>나 · {mine?.score}점 · {mine?.goCount}고 · 손패 {game.hand.length}장</h2>
                <div className="online-cards" aria-label="내 손패">
                  {game.hand.map(card => <Card key={card.id} card={card}
                    isSelectable={enabled && myTurn && game.phase === "play"}
                    onClick={enabled && myTurn && game.phase === "play" ? () => act("play", card.id) : undefined} />)}
                </div>
              </section>
              <section className="online-captures">
                {[{ name: "내 먹은 패", player: mine }, { name: "상대 먹은 패", player: opponent }].map(({ name, player }) => (
                  <details key={name}>
                    <summary>{name} · {player?.captured.length ?? 0}장</summary>
                    <div className="online-cards">{player?.captured.map(card => <Card key={card.id} card={card} />)}</div>
                  </details>
                ))}
              </section>
            </div>
          )}
        </>
      )}
    </main>
  );
}
