import type { RoomView } from '../../shared/online';

export function acceptRoomState(previous: RoomView | null, next: RoomView): RoomView {
  if (previous?.code === next.code && (previous.round > next.round ||
    previous.round === next.round && previous.game && next.game && previous.game.revision > next.game.revision)) return previous;
  if (previous?.code === next.code && previous.round === next.round && previous.logs && next.logs &&
    (previous.logs.at(-1)?.sequence ?? 0) > (next.logs.at(-1)?.sequence ?? 0)) return previous;
  return next;
}
export function boardPresentationKey(room: RoomView, epoch: number): string {
  return `${room.code}:${room.round}:${epoch}`;
}
