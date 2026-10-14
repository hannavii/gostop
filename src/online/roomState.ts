import type { RoomView } from '../../shared/online';

export function acceptRoomState(previous: RoomView | null, next: RoomView): RoomView {
  if (previous?.code === next.code && (previous.round > next.round ||
    previous.round === next.round && previous.game && next.game && previous.game.revision > next.game.revision)) return previous;
  return next;
}
export function boardPresentationKey(room: RoomView, epoch: number): string {
  return `${room.code}:${room.round}:${epoch}`;
}
