import { useState } from 'react';
import { recentGameHistory } from './recentGameHistory';
import type { RecentGame } from './recentGameHistory';
import MatgoOnlineSettlement from './MatgoOnlineSettlement';
import GostopOnlineSettlement from './GostopOnlineSettlement';
const outcomes = { win: '승', loss: '패', draw: '무승부' };
const events: Record<string, string> = { bomb: '폭탄', shake: '흔들기', ppeok: '뻑', jjok: '쪽', ttadak: '따닥', pansseul: '판쓸이', 'ppeok-capture': '뻑 먹기', 'self-ppeok-capture': '자뻑 먹기' };
export default function RecentGames({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState(() => recentGameHistory.list());
  const [selected, setSelected] = useState<RecentGame | null>(null);
  const [message, setMessage] = useState('');
  const wins = entries.filter(e => e.record.results[e.you].outcome === 'win').length;
  const losses = entries.filter(e => e.record.results[e.you].outcome === 'loss').length;
  return <main className="online-page recent-games">
    <button onClick={() => selected ? setSelected(null) : onBack()}>← {selected ? '최근 경기 목록' : '온라인으로'}</button>
    <h1>최근 경기</h1>
    <p>현재 브라우저에 저장된 최근 경기 기준입니다. 계정 기반 공식 영구 전적이 아니며, 최대 30경기를 보관합니다.</p>
    <p>{entries.length}경기 · {wins}승 {losses}패 {entries.length - wins - losses}무 · 승률 {entries.length ? Math.round(wins / entries.length * 100) : 0}%</p>
    {message && <p role="status">{message}</p>}
    {!entries.length && <p>아직 저장된 경기가 없습니다.</p>}
    {(selected ? [selected] : entries).map(entry => {
      const { record: r, you } = entry, mine = r.results[you];
      const name = (seat: number) => r.players[seat].nickname;
      return <article className="recent-game" key={r.id}>
        <h2>{outcomes[mine.outcome]} · {r.mode === 'matgo' ? '2인 맞고' : '3인 고스톱'} · {r.round}판</h2>
        <time dateTime={r.completedAt}>{new Date(r.completedAt).toLocaleString('ko-KR')}</time>
        <p>참가자: {r.players.map(p => `${p.nickname}${p.seat === you ? ' (나)' : ''}`).join(' · ')}</p>
        <p>내 점수 {mine.score}점 · 수령 {mine.received}점 · 부담 {mine.payment}점 · GO {mine.goCount}회</p>
        <p>승자: {r.winnerSeat === 'draw' ? '무승부' : name(r.winnerSeat)}</p>
        {r.specialEvents.map(e => <p key={`${e.playerSeat}:${e.type}`}>{name(e.playerSeat)} · {events[e.type]} {e.count}회</p>)}
        {!selected ? <button onClick={() => setSelected(entry)}>상세 보기</button> : <>
          {r.results.map(p => <p key={p.seat}>{name(p.seat)} · {outcomes[p.outcome]} · {p.score}점 · GO {p.goCount}회 · 수령 {p.received}점 · 부담 {p.payment}점</p>)}
          {r.settlement && r.winnerSeat !== 'draw' && <MatgoOnlineSettlement settlement={r.settlement} winner={name(r.winnerSeat)} loser={name(r.winnerSeat === 0 ? 1 : 0)} />}
          {r.gostopSettlement && <GostopOnlineSettlement settlement={r.gostopSettlement} name={name} />}
        </>}
      </article>;
    })}
    {!!entries.length && <button onClick={() => {
      if (window.confirm('최근 경기 기록을 모두 삭제할까요?')) {
        if (recentGameHistory.clear()) { setEntries([]); setSelected(null); }
        else setMessage('기록을 삭제하지 못했습니다. 브라우저 저장소 설정을 확인해주세요.');
      }
    }}>최근 경기 기록 삭제</button>}
  </main>;
}
