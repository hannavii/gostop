import { Fragment, useEffect, useRef, useState } from "react";
import type { GameAction, GameView, RoomView, Seat } from "../../shared/online";
import RoomCode from "./RoomCode";
import Card from "../components/Card";
import CapturedPanel from "../components/CapturedPanel";
import CapturedCardsModal from "../components/CapturedCardsModal";
import MatgoTable from "../components/MatgoTable";
import { GAME_SPEED, GAME_SPEED_STYLE } from "../components/matgoSpeed";
import { getSpecialEventName } from "../components/matgoEvents";
import type { HwatuCard } from "../types/game";
import GostopOnlineSettlement from "./GostopOnlineSettlement";

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
      const isDraw = game.specialEvents.includes("bomb-pass") ||
        game.revealed.indexOf(card) >= (game.specialEvents.includes("bomb") ? 3 : 1);
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
  const [prompt, setPrompt] = useState<{ revision: number; cardId: string; type: "bomb" | "shake" } | null>(null);
  const specialPrompt = prompt?.revision === game.revision && game.phase === "play" && game.turn === room.you ? prompt : null;
  const [expandedPpeokMonth, setExpandedPpeokMonth] = useState<number | null>(null);
  const visual = usePresentation(game, room.you);
  const mine = game.players[room.you];
  const three = game.mode === "gostop";
  const relativeSeat = (seat: Seat) => (seat - room.you + game.players.length) % game.players.length;
  const opponents = game.players.filter(p => p.seat !== room.you).sort((a, b) => relativeSeat(a.seat) - relativeSeat(b.seat));
  const name = (seat: Seat) => room.connections[seat].nickname;
  const myTurn = game.turn === room.you;
  const finished = game.phase === "finished";
  const animating = Boolean(visual.card || visual.captured || visual.effect);
  const canAct = enabled && !animating;
  const selected = detail === null ? null : game.players[detail];
  const result = game.result;
  const settlement = result?.settlement;
  const turnMessage = message || (finished ? "게임이 끝났습니다." : !myTurn
    ? game.phase === "choose" ? `${name(game.turn)}님이 바닥패를 선택하고 있습니다.` : game.phase === "go-stop" ? `${name(game.turn)}님이 GO / STOP을 선택하고 있습니다.` : `${name(game.turn)}님 차례입니다.`
    : game.phase === "play" ? "낼 카드를 선택하세요." : "");
  return <main className={`game ${three ? "gostop3-game online-gostop-game" : "online-matgo-game"} ${animating ? "is-animating" : ""}`} style={GAME_SPEED_STYLE}>
    <nav className="online-game-toolbar" aria-label="방 정보">
      <RoomCode code={room.code} />
      <span> {room.occupancy}/{room.capacity}명 · {three ? "3인 고스톱" : "2인 맞고"}</span>
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
    {selected && <CapturedCardsModal title={detail === room.you ? "내 먹은 패" : `${name(selected.seat)} 먹은 패`}
      cards={selected.captured} totalScore={selected.score} goCount={selected.goCount}
      shakeMonths={selected.shakeMonths} bombCount={selected.bombCount} onClose={() => setDetail(null)} />}
    {[...opponents, mine].map(player => <CapturedPanel key={player.seat}
      title={player.seat === room.you ? "내 먹은 패" : `${name(player.seat)} 먹은 패`}
      position={three ? player.seat === room.you ? "player" : relativeSeat(player.seat) === 1 ? "opponent1" : "opponent2" : undefined}
      side={player.seat === room.you ? "right" : "left"} cards={player.captured}
      score={{ total: player.score }} goCount={player.goCount} shakeCount={player.shakeMonths.length} shakeMonths={player.shakeMonths} bombCount={player.bombCount}
      onOpenDetails={() => setDetail(player.seat)} />)}
    <section className={three ? "gostop3-opponents-area" : "opponent-area"}>
      {opponents.map(opponent => {
        const content = <>
      <h2>{opponent.seat === room.host && <span aria-label="방장">👑 </span>}{name(opponent.seat)}{game.turn === opponent.seat && !finished && " ◀"}</h2>
      <small className="online-player-connection">{room.connections[opponent.seat].connected ? "접속 중" : "재접속 대기"}</small>
      <div className={`card-row${three ? " gostop3-opponent-hand" : ""}`} aria-label={three ? `${name(opponent.seat)} 손패` : "상대 손패"}>
        {Array.from({ length: opponent.handCount }, (_, i) => <Card key={i} isBack />)}
      </div>
      <p>손패 {opponent.handCount}장 · 점수 {opponent.score}점 · GO {opponent.goCount}회 · 폭탄패 {opponent.bombPassCount}장</p>
      </>;
        return three ? <div key={opponent.seat} className="gostop3-opponent-zone">{content}</div>
          : <Fragment key={opponent.seat}>{content}</Fragment>;
      })}
    </section>
    <MatgoTable className={three ? "gostop3-table" : undefined}
      ppeokLabels={three ? Object.fromEntries(game.ppeokStacks.map(stack => [stack.month, `${name(stack.owner)}가 만든 뻑`])) : undefined}
      floorCards={game.floor} ppeokStacks={game.ppeokStacks.map(stack => ({ ...stack,
      owner: stack.owner === room.you ? "player" : "opponent" }))}
      expandedPpeokMonth={expandedPpeokMonth} setExpandedPpeokMonth={setExpandedPpeokMonth}
      pendingChoice={myTurn && game.choice ? { matchingCards: game.choice } : null}
      turnMessage={turnMessage} isAnimating={!canAct} gameOver={finished}
      gameStarted drawCount={game.drawCount} handleFloorCardChoice={card => act("choose", card.id)} />
    <section className={`player-area${three ? " gostop3-player-area" : ""}`}>
      <h2>{room.you === room.host && <span aria-label="방장">👑 </span>}{name(room.you)} (나){myTurn && !finished && " ◀"}</h2>
      <small>{room.connections[room.you].connected ? "접속 중" : "재접속 대기"}</small>
      <div className={`card-row${three ? " gostop3-player-hand" : ""}`} aria-label="내 손패">{game.hand.map(card => <Card key={card.id} card={card}
        onClick={canAct && myTurn && game.phase === "play" && !specialPrompt ? () => {
          const option = game.specialOptions.find(option => option.cardId === card.id);
          if (option) setPrompt({ ...option, revision: game.revision });
          else act("play", card.id);
        } : undefined} />)}</div>
      {myTurn && game.phase === "play" && mine.bombPassCount > 0 && <button className="bomb-pass-button"
        disabled={!canAct || !!specialPrompt} onClick={() => act("bomb-pass")}>폭탄 패 사용 · 더미만 뒤집기 ({mine.bombPassCount})</button>}
      <p>손패 {game.hand.length}장 · 점수 {mine.score}점 · GO {mine.goCount}회</p>
    </section>
    {specialPrompt && <div className="go-stop-overlay"><div className="go-stop-modal" role="dialog" aria-label="특수 행동 선택">
      <h2>{specialPrompt.type === "bomb" ? "폭탄 가능!" : "흔들기 가능!"}</h2>
      <p>{game.hand.find(card => card.id === specialPrompt.cardId)?.month}월 패를 어떻게 내시겠습니까?</p>
      <div className="go-stop-buttons">
        <button disabled={!canAct} onClick={() => act(specialPrompt.type, specialPrompt.cardId)}>{specialPrompt.type === "bomb" ? "폭탄 사용" : "흔들기"}</button>
        <button disabled={!canAct} onClick={() => act("play", specialPrompt.cardId)}>그냥 한 장 내기</button>
        <button disabled={!canAct} onClick={() => setPrompt(null)}>취소</button>
      </div>{message && <p role="alert">{message}</p>}
    </div></div>}
    {myTurn && game.phase === "go-stop" && !animating && <div className="go-stop-overlay"><div className="go-stop-modal">
      <div className="go-stop-small">현재 점수</div><div className="go-stop-score">{mine.score}점</div>
      <p>GO 하시겠습니까, STOP 하시겠습니까?</p><div className="go-stop-buttons">
        <button className="go-button" disabled={!canAct} onClick={() => act("go")}>GO</button>
        <button className="stop-button" disabled={!canAct} onClick={() => act("stop")}>STOP</button>
      </div>{message && <p role="alert">{message}</p>}
    </div></div>}
    {result && !animating && <div className="game-over-overlay"><div className="game-over-modal">
      <div className="game-over-label">게임 종료</div>
      <h2>{result.winner === "draw" ? "나가리 · 무승부" : result.winner === room.you ? "승리!" : `${name(result.winner)} 승리`}</h2>
      {three ? <div className="gostop3-final-scores">{[mine, ...opponents].map(p =>
        <div key={p.seat}><span>{name(p.seat)} 점수</span><strong>{p.score}점</strong><small>{p.goCount} GO</small></div>)}</div>
        : <div className="game-over-score-board"><span>내 점수 {mine.score}점</span><span>{name(opponents[0].seat)} 점수 {opponents[0].score}점</span></div>}
      {result.gostopSettlement && <GostopOnlineSettlement settlement={result.gostopSettlement} name={name} />}
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
