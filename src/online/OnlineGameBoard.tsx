import TurnCountdown from "./TurnCountdown";
import ConnectionStatus, { ReconnectNotice } from "./ConnectionStatus";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { GameAction, GameView, RoomView, Seat } from "../../shared/online";
import RoomCode from "./RoomCode";
import Card from "../components/Card";
import CapturedPanel from "../components/CapturedPanel";
import CapturedCardsModal from "../components/CapturedCardsModal";
import MatgoTable from "../components/MatgoTable";
import { GAME_SPEED_STYLE } from "../components/matgoSpeed";
import { usePresentation } from "./usePresentation";
import GostopOnlineSettlement from "./GostopOnlineSettlement";
import MatgoOnlineSettlement from "./MatgoOnlineSettlement";

type Props = {
  room: RoomView; game: GameView; enabled: boolean; message: string;
  act: (type: GameAction["type"], cardId?: string) => void;
  onRematch: (ready: boolean) => void;
  onSync: () => void; onLeave: () => void;
};
export default function OnlineGameBoard({ room, game: latestGame, enabled, message, act, onRematch, onSync, onLeave }: Props) {
  const { game, visual, animating } = usePresentation(latestGame, room.you);
  const [detail, setDetail] = useState<Seat | null>(null);
  const [prompt, setPrompt] = useState<{ revision: number; cardId: string; type: "bomb" | "shake" } | null>(null);
  const specialPrompt = prompt?.revision === game.revision && game.canPlayHand &&
    game.specialOptions.some(option => option.cardId === prompt.cardId && option.type === prompt.type) ? prompt : null;
  const [expandedPpeokMonth, setExpandedPpeokMonth] = useState<number | null>(null);
  const boardRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const measure = () => {
      if (!window.matchMedia('(max-width: 700px)').matches) return;
      const bounds = board.getBoundingClientRect();
      const anchor = (name: string, element: Element | null) => {
        if (!element) return;
        const rect = element.getBoundingClientRect();
        board.style.setProperty(`--${name}-x`, `${rect.left + rect.width / 2 - bounds.left + board.scrollLeft}px`);
        let centerY = rect.top + rect.height / 2;
        if (name === 'floor') {
          const table = board.querySelector('.table')!.getBoundingClientRect();
          // The floor may be taller than its scrollport, or empty after a capture.
          const top = Math.max(rect.top, table.top);
          const bottom = Math.min(rect.bottom, table.bottom);
          centerY = bottom > top ? (top + bottom) / 2 : table.top + table.height / 2;
        }
        board.style.setProperty(`--${name}-y`, `${centerY - bounds.top + board.scrollTop}px`);
      };
      anchor('player', board.querySelector('.player-area .card-row'));
      const relative = (game.turn - room.you + game.players.length) % game.players.length;
      anchor('opponent', board.querySelector(game.mode === 'gostop'
        ? `.gostop3-opponent-zone:nth-child(${Math.max(1, relative)}) .card-row` : '.opponent-area .card-row'));
      anchor('draw', board.querySelector('.draw-pile-area .card-back') ?? board.querySelector('.draw-pile-area'));
      anchor('floor', board.querySelector('.floor-cards'));
      const recipient = visual.captured && latestGame.players.find(player =>
        player.captured.some(card => card.id === visual.captured?.cards[0]?.id));
      const captureRelative = recipient ? (recipient.seat - room.you + game.players.length) % game.players.length : 0;
      anchor('capture', board.querySelector(game.mode === 'gostop'
        ? `.gostop3-captured-panel--${captureRelative ? `opponent${captureRelative}` : 'player'}`
        : `.captured-panel--${captureRelative ? 'left' : 'right'}`));
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of board.querySelectorAll('.card-row, .floor-cards, .captured-panel, .draw-pile-area')) observer.observe(element);
    observer.observe(board);
    window.addEventListener('resize', measure);
    board.addEventListener('scroll', measure, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); board.removeEventListener('scroll', measure, true); };
  }, [game.turn, game.mode, game.players.length, room.you, visual.captured, latestGame.players]);
  const mine = game.players[room.you];
  const three = game.mode === "gostop";
  const relativeSeat = (seat: Seat) => (seat - room.you + game.players.length) % game.players.length;
  const opponents = game.players.filter(p => p.seat !== room.you).sort((a, b) => relativeSeat(a.seat) - relativeSeat(b.seat));
  const name = (seat: Seat) => room.connections[seat].nickname;
  const myTurn = game.turn === room.you;
  const finished = game.phase === "finished";
  const activeConnected = room.connections[latestGame.turn].connected;
  const canAct = enabled && !animating && (latestGame.phase === "finished" || activeConnected);
  const selected = detail === null ? null : game.players[detail];
  const result = game.result;
  const settlement = result?.settlement;
  const turnMessage = !activeConnected && latestGame.phase !== "finished"
    ? `${name(latestGame.turn)}님의 재접속을 기다리는 중입니다.` : message || (finished ? "게임이 끝났습니다." : !myTurn
    ? game.phase === "choose" ? `${name(game.turn)}님이 바닥패를 선택하고 있습니다.` : game.phase === "go-stop" ? `${name(game.turn)}님이 GO / STOP을 선택하고 있습니다.` : `${name(game.turn)}님 차례입니다.`
    : game.phase === "play" ? game.canPlayHand ? "낼 카드를 선택하세요." : "남은 폭탄 패스를 사용하세요." : "");
  return <main data-testid="online-board" data-seat={room.you} data-turn={latestGame.turn} data-revision={latestGame.revision} data-round={room.round} ref={boardRef} className={`game ${three ? "gostop3-game online-gostop-game" : "online-matgo-game"} ${animating ? "is-animating" : ""}`} style={GAME_SPEED_STYLE}>
    <nav className="online-game-toolbar" aria-label="방 정보">
      <RoomCode code={room.code} />
      {room.turnTimer && activeConnected && <TurnCountdown timer={room.turnTimer} name={room.connections[room.turnTimer.timedPlayerSeat].nickname} />}
      <span> {room.occupancy}/{room.capacity}명 · {three ? "3인 고스톱" : "2인 맞고"}</span>
      <button disabled={!enabled} onClick={onSync}>새로고침</button>
      <button disabled={!enabled} onClick={onLeave}>방 나가기</button>
      <ReconnectNotice connections={room.connections} activeSeat={latestGame.phase === "finished" ? undefined : latestGame.turn} />
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
      <ConnectionStatus player={room.connections[opponent.seat]} />
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
      <ConnectionStatus player={room.connections[room.you]} />
      <div data-testid="own-hand" className={`card-row${three ? " gostop3-player-hand" : ""}`} aria-label="내 손패">{game.hand.map(card => <Card key={card.id} card={card}
        onClick={canAct && game.canPlayHand && !specialPrompt ? () => {
          const option = game.specialOptions.find(option => option.cardId === card.id);
          if (option) setPrompt({ ...option, revision: game.revision });
          else act("play", card.id);
        } : undefined} />)}</div>
      {myTurn && game.phase === "play" && mine.bombPassCount > 0 && <button className="bomb-pass-button"
        disabled={!canAct || !!specialPrompt} onClick={() => act("bomb-pass")}>폭탄 패 사용 · 더미만 뒤집기 ({mine.bombPassCount})</button>}
      <p>손패 {game.hand.length}장 · 점수 {mine.score}점 · GO {mine.goCount}회</p>
    </section>
    {specialPrompt && <div className="special-action-overlay"><div className="special-action-modal" role="dialog" aria-modal="true" aria-label="특수 행동 선택">
      <h2>{specialPrompt.type === "bomb" ? "폭탄 가능!" : "흔들기 가능!"}</h2>
      <p>{game.hand.find(card => card.id === specialPrompt.cardId)?.month}월 패를 어떻게 내시겠습니까?</p>
      <div className="special-action-buttons">
        <button className="special-action-confirm" disabled={!canAct} onClick={() => act(specialPrompt.type, specialPrompt.cardId)}>{specialPrompt.type === "bomb" ? "폭탄 사용" : "흔들기"}</button>
        <button className="special-action-normal" disabled={!canAct} onClick={() => act("play", specialPrompt.cardId)}>그냥 한 장 내기</button>
        <button className="special-action-normal" disabled={!canAct} onClick={() => setPrompt(null)}>취소</button>
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
      {result.gostopSettlement && <GostopOnlineSettlement settlement={result.gostopSettlement} name={name} />}
      {settlement && result.winner !== "draw" && <MatgoOnlineSettlement settlement={settlement}
        winner={name(result.winner)} loser={name(game.players.find(p => p.seat !== result.winner)!.seat)} />}
      {three ? <div className="gostop3-final-scores">{[mine, ...opponents].map(p =>
        <div key={p.seat}><span>{name(p.seat)} · {result.winner === "draw" ? "무승부" : p.seat === result.winner ? "승자" : "패자"}</span><strong>{p.score}점</strong><small>{p.goCount} GO</small></div>)}</div>
        : <div className="game-over-score-board"><span>내 점수 {mine.score}점</span><span>{name(opponents[0].seat)} 점수 {opponents[0].score}점</span></div>}
      <section className="online-result-captured" aria-label="최종 획득패">
        {[mine, ...opponents].map(p => <button key={p.seat} onClick={() => setDetail(p.seat)}>{name(p.seat)} 획득패 보기</button>)}
      </section>
      <section className="rematch-status" aria-label="다시하기 동의 상태" aria-live="polite">
        <p>모두 다시하기에 동의하고 접속하면 같은 방에서 새 판을 시작합니다.</p>
        <ul>{room.connections.map(player => <li key={player.seat}>
          <span>{player.nickname}{player.seat === room.you ? " (나)" : ""}</span>
          <strong>{player.rematchReady ? "다시하기 동의" : "대기 중"}<ConnectionStatus player={player} /></strong>
        </li>)}</ul>
      </section>
      <div className="rematch-actions">
        <button className="rematch-button" disabled={!canAct} onClick={() => onRematch(!room.connections[room.you].rematchReady)}>
          {room.connections[room.you].rematchReady ? "다시하기 취소" : "다시하기"}
        </button>
        <button className="restart-game-button" disabled={!enabled} onClick={onLeave}>방 나가기</button>
      </div>{message && <p role="alert">{message}</p>}
    </div></div>}
  </main>;
}
