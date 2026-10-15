import type { GameLogEntry, Seat } from '../../shared/online';
import { getSpecialEventName } from '../components/matgoEvents';

export function gameLogText(entry: GameLogEntry, name: (seat: Seat) => string): string {
  if (entry.type === 'start') return entry.payload.rematch ? '재대결 새 판을 시작했습니다.' : '게임을 시작했습니다.';
  if (entry.type === 'finished') return entry.payload.winner === 'draw' ? '무승부로 게임이 종료되었습니다.'
    : `${name(entry.payload.winner)}님 승리로 게임이 종료되었습니다.`;
  const who = `${name(entry.playerSeat)}님`;
  if (entry.type === 'disconnect') return `${who}의 연결이 끊겼습니다.`;
  if (entry.type === 'reconnect') return `${who}이 다시 연결되었습니다.`;
  if (entry.type === 'special') return `${who} · ${getSpecialEventName(entry.payload.event)}`;
  const automatic = entry.payload.automatic ? ' (시간 초과 · 자동 행동)' : '';
  switch (entry.type) {
    case 'play': return `${who}이 ${entry.payload.month}월 패를 냈습니다.${automatic}`;
    case 'choose': return `${who}이 ${entry.payload.month}월 바닥패를 선택했습니다.${automatic}`;
    case 'bomb': return `${who}이 ${entry.payload.month}월 폭탄을 사용했습니다.${automatic}`;
    case 'shake': return `${who}이 ${entry.payload.month}월 흔들기를 사용했습니다.${automatic}`;
    case 'bomb-pass': return `${who}이 폭탄 패스를 사용했습니다.${automatic}`;
    case 'go': return `${who}이 GO를 선택했습니다. (${entry.payload.goCount}고)${automatic}`;
    case 'stop': return `${who}이 STOP을 선택했습니다.${automatic}`;
  }
}
