import { useId, useState } from 'react';
import type { GameLogEntry, Seat } from '../../shared/online';
import { gameLogText } from './gameLogText';

export default function GameLogPanel({ entries, name }: { entries: GameLogEntry[]; name: (seat: Seat) => string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <section className="online-game-logs" aria-label="최근 행동">
    <button type="button" data-testid="game-log-toggle" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)}>최근 행동 {entries.length}{open ? ' 닫기' : ' 열기'}</button>
    {open && <div id={id} className="online-game-log-panel" data-testid="game-log-panel" tabIndex={0}>
      <h3>최근 행동 · 최신순</h3>
      <ol>{[...entries].reverse().map(entry => <li key={entry.id} data-testid="game-log-entry"
        data-log-id={entry.id} data-log-type={entry.type} data-log-sequence={entry.sequence}
        data-log-revision={entry.revision}
        data-log-automatic={'automatic' in entry.payload ? entry.payload.automatic : undefined}>
        {gameLogText(entry, name)}
      </li>)}</ol>
      {!entries.length && <p>아직 기록된 행동이 없습니다.</p>}
    </div>}
  </section>;
}
