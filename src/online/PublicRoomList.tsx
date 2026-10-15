import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClientEvents, PublicRoomSummary, ServerEvents } from '../../shared/online';

export default function PublicRoomList({ getSocket, connected, enabled, validNickname, onJoin }: {
  getSocket: () => Socket<ServerEvents, ClientEvents> | null;
  connected: boolean; enabled: boolean; validNickname: boolean;
  onJoin: (code: string) => Promise<void>;
}) {
  const [rooms, setRooms] = useState<PublicRoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !connected) return;
    let disposed = false, inFlight = false, pending = false;
    async function refresh() {
      if (disposed || !socket?.connected) return;
      if (inFlight) { pending = true; return; }
      inFlight = true; setLoading(true); setError('');
      try {
        do {
          pending = false;
          const reply = await socket.timeout(5000).emitWithAck('room:list');
          if (disposed) return;
          if (!reply.ok) throw new Error('List request rejected');
        } while (pending);
      } catch {
        if (!disposed) setError('공개방 목록을 불러오지 못했습니다. 다시 시도해주세요.');
      } finally {
        inFlight = false;
        if (!disposed) setLoading(false);
      }
    }
    const receive = (next: PublicRoomSummary[]) => { if (!disposed) setRooms(next); };
    const changed = () => { void refresh(); };
    socket.on('room:list', receive);
    socket.on('room:list-changed', changed);
    reload.current = refresh;
    queueMicrotask(() => void refresh());
    return () => { disposed = true; reload.current = null; socket.off('room:list', receive); socket.off('room:list-changed', changed); };
  }, [getSocket, connected]);

  return <section className="online-public-rooms" data-testid="public-rooms" aria-labelledby="public-rooms-heading">
    <div className="online-public-heading">
      <h3 id="public-rooms-heading">공개방</h3>
      <button type="button" disabled={!connected || loading} onClick={() => void reload.current?.()}>공개방 새로고침</button>
    </div>
    <div aria-live="polite">
      {!connected ? <p>서버에 연결되면 공개방을 불러옵니다.</p>
        : loading ? <p>공개방을 불러오는 중입니다.</p>
          : error ? <p className="online-public-error" role="alert">{error}</p>
            : !rooms.length && <p>현재 참가 가능한 공개방이 없습니다.</p>}
    </div>
    {!validNickname && <p>닉네임을 입력하면 공개방에 참가할 수 있습니다.</p>}
    {!error && <ul className="online-public-list">
      {rooms.map(room => <li key={room.roomCode} data-testid="public-room" data-room-code={room.roomCode}>
        <div><strong>{room.mode === 'gostop' ? '3인 고스톱' : '2인 맞고'}</strong>
          <span className="online-public-code">{room.roomCode}</span></div>
        <span aria-label="참가 인원">{room.playerCount} / {room.maxPlayers}</span>
        <button type="button" disabled={!enabled || loading || !validNickname}
          aria-label={`${room.roomCode} 방 참가`} onClick={() => { void onJoin(room.roomCode).finally(() => reload.current?.()); }}>참가</button>
      </li>)}
    </ul>}
  </section>;
}
