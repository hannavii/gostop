import { useEffect, useState } from 'react';
import type { RoomView, Seat } from '../../shared/online';
import { reconnectSeconds } from './reconnectCountdown';

type Connection = RoomView['connections'][number];

function ReconnectCountdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);
  return <span className="online-reconnect-seconds" data-testid="reconnect-countdown">
    {reconnectSeconds(deadline, now)}초 남음
  </span>;
}

export default function ConnectionStatus({ player }: { player: Connection }) {
  return <small className={`online-player-connection ${player.connected ? 'online-connected' : 'online-disconnected'}`}
    data-testid={`connection-${player.seat}`}>
    <span aria-hidden="true">{player.connected ? '●' : '○'} </span>
    {player.connected ? '접속 중' : '재접속 대기 중'}
    {!player.connected && (player.reconnectDeadline === null ? ' · 서버 확인 중' : <>
      {' · '}<ReconnectCountdown key={player.reconnectDeadline} deadline={player.reconnectDeadline} />
    </>)}
  </small>;
}

export function ReconnectNotice({ connections, activeSeat }: { connections: Connection[]; activeSeat?: Seat }) {
  const offline = connections.filter(player => !player.connected);
  if (!offline.length) return null;
  const active = offline.find(player => player.seat === activeSeat);
  return <aside className="online-reconnect-notice" data-testid="reconnect-notice" aria-label="재접속 안내">
    <p role="status">{active ? `${active.nickname}님의 재접속을 기다리는 중입니다.`
      : activeSeat === undefined ? '연결이 끊긴 플레이어의 재접속을 기다립니다.'
        : '접속 중인 플레이어의 차례는 계속 진행됩니다.'}</p>
    <ul>{offline.map(player => <li key={player.seat}>
      <span>{player.nickname}님</span> <ConnectionStatus player={player} />
    </li>)}</ul>
  </aside>;
}
