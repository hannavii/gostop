import { useState } from 'react';
import type { SpectatorRoomView, Seat } from '../../shared/online';
import Card from '../components/Card';
import CapturedCardsModal from '../components/CapturedCardsModal';
import RoomCode from './RoomCode';
import TurnCountdown from './TurnCountdown';
import GameLogPanel from './GameLogPanel';
import ConnectionStatus, { ReconnectNotice } from './ConnectionStatus';
import MatgoOnlineSettlement from './MatgoOnlineSettlement';
import GostopOnlineSettlement from './GostopOnlineSettlement';

export default function SpectatorGameBoard({ room, enabled, message, onLeave }: {
  room: SpectatorRoomView; enabled: boolean; message: string; onLeave: () => void;
}) {
  const [detail, setDetail] = useState<Seat | null>(null);
  const game = room.game!;
  const name = (seat: Seat) => room.connections[seat].nickname;
  const selected = detail === null ? null : game.players[detail];
  const result = game.result;
  return <main className="online-page spectator-page" data-testid="spectator-board" data-turn={game.turn}
    data-round={room.round} data-revision={game.revision}>
    <nav className="online-game-toolbar" aria-label="관전 정보">
      <strong>관전 중</strong><RoomCode code={room.code} />
      <span>{room.mode === 'gostop' ? '3인 고스톱' : '2인 맞고'} · 플레이어 {room.occupancy}/{room.capacity}명</span>
      <button type="button" disabled={!enabled} onClick={onLeave}>방 나가기</button>
      {room.turnTimer && <TurnCountdown timer={room.turnTimer} name={name(room.turnTimer.timedPlayerSeat)} />}
    </nav>
    {message && <p role="status">{message}</p>}
    <ReconnectNotice connections={room.connections} activeSeat={game.phase === 'finished' ? undefined : game.turn} />
    <p role="status">{result ? '게임 종료' : `${name(game.turn)}님 차례입니다.`}</p>
    <section className="spectator-players" aria-label="플레이어 공개 상태">
      {game.players.map(player => <article key={player.seat} className="spectator-player" aria-label={`${name(player.seat)} 공개 상태`}>
        <h2>{name(player.seat)} {game.turn === player.seat && !result && '· 현재 턴'}</h2>
        <ConnectionStatus player={room.connections[player.seat]} />
        <p>손패 {player.handCount}장 · 점수 {player.score}점 · GO {player.goCount}회</p>
        <p>폭탄 {player.bombCount}회 · 폭탄 패스 {player.bombPassCount}장 · 흔들기 {player.shakeMonths.length}회</p>
        <div className="card-row spectator-hand" aria-label={`${name(player.seat)} 비공개 손패`}>
          {Array.from({ length: player.handCount }, (_, i) => <Card key={i} isBack />)}
        </div>
        <button type="button" onClick={() => setDetail(player.seat)}>{name(player.seat)} 획득패 {player.captured.length}장 보기</button>
        <div className="card-row spectator-captured" aria-label={`${name(player.seat)} 획득패`}>
          {player.captured.map(card => <Card key={card.id} card={card} />)}
        </div>
      </article>)}
    </section>
    <section className="spectator-table" aria-label="바닥패">
      <h2>바닥패 · 더미 {game.drawCount}장</h2>
      <div className="card-row">{game.floor.map(card => <Card key={card.id} card={card} />)}</div>
      {game.ppeokStacks.map(stack => <p key={stack.month}>{stack.month}월 · {name(stack.owner)}님의 뻑</p>)}
    </section>
    {game.revealed.length > 0 && <section aria-label="최근 공개된 패">
      <h2>최근 공개된 패</h2>
      <div className="card-row">{game.revealed.map(card => <Card key={card.id} card={card} />)}</div>
    </section>}
    <GameLogPanel entries={room.logs ?? []} name={name} />
    {result && <section aria-label="게임 종료 결과">
      <h2>{result.winner === 'draw' ? '나가리 · 무승부' : `${name(result.winner)} 승리`}</h2>
      {result.gostopSettlement && <GostopOnlineSettlement settlement={result.gostopSettlement} name={name} />}
      {result.settlement && result.winner !== 'draw' && <MatgoOnlineSettlement settlement={result.settlement}
        winner={name(result.winner)} loser={name(game.players.find(p => p.seat !== result.winner)!.seat)} />}
      <p>플레이어들이 다시하기에 동의하면 다음 판도 계속 관전합니다.</p>
    </section>}
    {selected && <CapturedCardsModal title={`${name(selected.seat)} 먹은 패`} cards={selected.captured}
      totalScore={selected.score} goCount={selected.goCount} shakeMonths={selected.shakeMonths}
      bombCount={selected.bombCount} onClose={() => setDetail(null)} />}
  </main>;
}
