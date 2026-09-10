import { useEffect, useRef, useState } from "react";
import type { GameAction, GameView, RoomView, Seat } from "../../shared/online";
import Card from "../components/Card";
import CapturedPanel from "../components/CapturedPanel";
import CapturedCardsModal from "../components/CapturedCardsModal";
import MatgoTable from "../components/MatgoTable";
import { GAME_SPEED, GAME_SPEED_STYLE } from "../components/matgoSpeed";
import { getSpecialEventName } from "../components/matgoEvents";
import type { HwatuCard } from "../types/game";

type Props = {
  room: RoomView; game: GameView; enabled: boolean; message: string;
  act: (type: GameAction["type"], cardId?: string) => void;
  onSync: () => void; onLeave: () => void;
};
type Presentation = {
  card?: HwatuCard; kind?: string; faceUp?: boolean;
  captured?: { cards: HwatuCard[]; side: string };
  effect?: string;
};

// Presentation only: animate differences between public server snapshots.
// A newer snapshot cancels obsolete effects; it never waits for a local rules engine.
function usePresentation(game: GameView, you: Seat) {
  const previous = useRef(game);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [visual, setVisual] = useState<Presentation>({});
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const before = previous.current;
    if (before.revision === game.revision) return;
    previous.current = game;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const schedule = (value: Presentation, delay: number) => {
      timers.current.push(setTimeout(() => setVisual(value), delay));
    };
    const side = before.turn === you ? "player" : "opponent";
    const newCards = game.revealed.filter(card => !before.revealed.some(old => old.id === card.id));
    let delay = 0;
    for (const card of newCards) {
      const isDraw = game.revealed.indexOf(card) > 0;
      const kind = `${side}-${isDraw ? "draw" : "play"}`;
      const faceDown = isDraw || side === "opponent";
      schedule({ card, kind, faceUp: !faceDown }, delay);
      const move = isDraw ? GAME_SPEED.drawMove : side === "player" ? GAME_SPEED.playerPlay : GAME_SPEED.opponentPlay;
      if (faceDown) schedule({ card, kind, faceUp: true }, delay + move);
      delay += move + (faceDown ? GAME_SPEED.revealHold : 0);
    }
    for (const player of game.players) {
      const cards = player.captured.filter(card => !before.players[player.seat].captured.some(old => old.id === card.id));
      if (cards.length) {
        schedule({ captured: { cards, side: player.seat === you ? "player" : "opponent" } }, delay);
        delay += GAME_SPEED.captureMove;
      }
    }
    // GO/STOP and manual sync retain the last turn's events; don't replay them.
    if (newCards.length || game.phase !== before.phase && before.phase === "choose") {
      for (const event of game.specialEvents) {
        schedule({ effect: getSpecialEventName(event) }, delay);
        delay += GAME_SPEED.specialEffect;
      }
    }
    schedule({}, delay);
  }, [game, you]);
  return visual;
}

export default function OnlineGameBoard({ room, game, enabled, message, act, onSync, onLeave }: Props) {
  const [detail, setDetail] = useState<Seat | null>(null);
  const [expandedPpeokMonth, setExpandedPpeokMonth] = useState<number | null>(null);
  const visual = usePresentation(game, room.you);
  const mine = game.players[room.you];
  const opponent = game.players[room.you === 0 ? 1 : 0];
  const myTurn = game.turn === room.you;
  const finished = game.phase === "finished";
  const animating = Boolean(visual.card || visual.captured || visual.effect);
  const canAct = enabled && !animating;
  const selected = detail === null ? null : game.players[detail];
  const result = game.result;
  const settlement = result?.settlement;
  const turnMessage = message || (finished ? "게임이 끝났습니다." : !myTurn
    ? game.phase === "choose" ? "상대방이 바닥패를 선택하고 있습니다." : game.phase === "go-stop" ? "상대방이 GO / STOP을 선택하고 있습니다." : "상대방 차례입니다."
    : game.phase === "play" ? "낼 카드를 선택하세요." : "");
  return <main className={`game online-matgo-game ${animating ? "is-animating" : ""}`} style={GAME_SPEED_STYLE}>
    <nav className="online-game-toolbar" aria-label="방 정보">
      <span>방 <strong>{room.code}</strong> · {room.occupancy}/2명</span>
      <button disabled={!enabled} onClick={onSync}>새로고침</button>
      <button disabled={!enabled} onClick={onLeave}>방 나가기</button>
    </nav>
    {visual.effect && <div key={visual.effect} className="special-effect" role="status">{visual.effect}</div>}
    {visual.card && <div className="animation-layer" aria-hidden="true"><div key={visual.card.id} className={`flying-card flying-card--${visual.kind}`}>
      <div className={`flip-card ${visual.faceUp ? "is-flipped" : ""}`}>
        <div className="flip-card-inner">
          <div className="flying-face flying-face--back"><Card isBack /></div>
          <div className="flying-face flying-face--front"><Card card={visual.card} /></div>
        </div>
      </div>
    </div></div>}
    {visual.captured && <div className="capture-flight-layer" aria-hidden="true"><div key={visual.captured.side} className={`capture-flight capture-flight--${visual.captured.side}`}>
      {visual.captured.cards.map((card, index) => <div key={card.id} className="capture-flight-card" style={{ left: index * 10, top: index * 4 }}><Card card={card} /></div>)}
    </div></div>}
    {selected && <CapturedCardsModal title={detail === room.you ? "내 먹은 패" : "상대 먹은 패"}
      cards={selected.captured} totalScore={selected.score} goCount={selected.goCount} onClose={() => setDetail(null)} />}
    {[opponent, mine].map(player => <CapturedPanel key={player.seat}
      title={player.seat === room.you ? "내 먹은 패" : "상대 먹은 패"}
      side={player.seat === room.you ? "right" : "left"} cards={player.captured}
      score={{ total: player.score }} goCount={player.goCount} shakeCount={0} shakeMonths={[]} bombCount={0}
      onOpenDetails={() => setDetail(player.seat)} />)}
    <section className="opponent-area">
      <h2>상대방{!myTurn && !finished && " ◀"}</h2>
      <div className="card-row" aria-label="상대 손패">
        {Array.from({ length: opponent.handCount }, (_, i) => <Card key={i} isBack />)}
      </div>
      <p>손패 {opponent.handCount}장 · 점수 {opponent.score}점 · GO {opponent.goCount}회</p>
    </section>
    <MatgoTable floorCards={game.floor} ppeokStacks={game.ppeokStacks.map(stack => ({ ...stack,
      owner: (stack.owner === "player" ? 0 : 1) === room.you ? "player" : "opponent" }))}
      expandedPpeokMonth={expandedPpeokMonth} setExpandedPpeokMonth={setExpandedPpeokMonth}
      pendingChoice={myTurn && game.choice ? { matchingCards: game.choice } : null}
      turnMessage={turnMessage} isAnimating={!canAct} gameOver={finished}
      gameStarted drawCount={game.drawCount} handleFloorCardChoice={card => act("choose", card.id)} />
    <section className="player-area">
      <h2>내 패{myTurn && !finished && " ◀"}</h2>
      <div className="card-row" aria-label="내 손패">{game.hand.map(card => <Card key={card.id} card={card}
        onClick={canAct && myTurn && game.phase === "play" ? () => act("play", card.id) : undefined} />)}</div>
      <p>손패 {game.hand.length}장 · 점수 {mine.score}점 · GO {mine.goCount}회</p>
    </section>
    {myTurn && game.phase === "go-stop" && !animating && <div className="go-stop-overlay"><div className="go-stop-modal">
      <div className="go-stop-small">현재 점수</div><div className="go-stop-score">{mine.score}점</div>
      <p>GO 하시겠습니까, STOP 하시겠습니까?</p><div className="go-stop-buttons">
        <button className="go-button" disabled={!canAct} onClick={() => act("go")}>GO</button>
        <button className="stop-button" disabled={!canAct} onClick={() => act("stop")}>STOP</button>
      </div>{message && <p role="alert">{message}</p>}
    </div></div>}
    {result && !animating && <div className="game-over-overlay"><div className="game-over-modal">
      <div className="game-over-label">게임 종료</div>
      <h2>{result.winner === "draw" ? "나가리 · 무승부" : result.winner === room.you ? "승리!" : "상대방 승리"}</h2>
      <div className="game-over-score-board"><span>내 점수 {mine.score}점</span><span>상대 점수 {opponent.score}점</span></div>
      {settlement && <div className="settlement-board">
        <div className="settlement-row"><span>기본 점수</span><strong>{settlement.baseScore}점</strong></div>
        <div className="settlement-row"><span>GO 추가 점수</span><strong>+{settlement.goBonus}점</strong></div>
        <div className="settlement-multipliers">{settlement.multipliers.map(item => <div key={item.id} className="settlement-multiplier"><span>{item.label}</span><strong>×{item.multiplier}</strong></div>)}</div>
        <div className="settlement-total"><span>최종 정산 점수</span><strong>{settlement.finalScore}점</strong></div>
      </div>}
      <p>다시 플레이하려면 새 방을 만들어 주세요.</p>
      <button className="restart-game-button" disabled={!enabled} onClick={onLeave}>방 나가기</button>
    </div></div>}
  </main>;
}
