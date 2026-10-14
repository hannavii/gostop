import type { GameView, Seat } from '../../shared/online';
import type { HwatuCard } from '../types/game';
import { GAME_SPEED } from '../components/matgoSpeed';
import { getSpecialEventName } from '../components/matgoEvents';

export type Presentation = {
  card?: HwatuCard; kind?: string; faceUp?: boolean;
  captured?: { cards: HwatuCard[]; side: string }; effect?: string;
};
export type PresentationFrame = { game: GameView; visual: Presentation; duration: number };

// A pending choice can hold a publicly revealed card outside the server floor.
// Keep it visible while waiting for selection; never infer the selected match.
export function displaySnapshot(game: GameView): GameView {
  if (game.phase !== 'choose') return game;
  const located = new Set([...game.floor, ...game.players.flatMap(p => p.captured)].map(card => card.id));
  const pending = game.revealed.filter(card => !located.has(card.id));
  return pending.length ? { ...game, floor: [...game.floor, ...pending] } : game;
}

// Only public snapshot differences determine movement. No matching or scoring rules.
export function presentationFrames(before: GameView, next: GameView, you: Seat): PresentationFrame[] {
  const frames: PresentationFrame[] = [];
  const displayed = displaySnapshot(before);
  let shown = { ...displayed, hand: [...before.hand], floor: [...displayed.floor],
    players: before.players.map(player => ({ ...player, captured: [...player.captured] })) };
  const push = (visual: Presentation, duration: number) => frames.push({ game: shown, visual, duration });
  const side = before.turn === you ? 'player' : 'opponent';
  const newCards = next.revealed.filter(card => !before.revealed.some(old => old.id === card.id));
  for (const month of next.players[before.turn].shakeMonths.filter(month => !before.players[before.turn].shakeMonths.includes(month))) {
    push({ effect: `${side === 'player' ? '흔들기' : '상대방 흔들기'} ${month}월 ×3 공개` }, GAME_SPEED.shakeReveal);
  }
  for (const card of newCards) {
    const isDraw = next.specialEvents.includes('bomb-pass') || next.revealed.indexOf(card) >= (next.specialEvents.includes('bomb') ? 3 : 1);
    const kind = `${side}-${isDraw ? 'draw' : 'play'}`;
    const faceDown = isDraw || side === 'opponent';
    shown = { ...shown, hand: shown.hand.filter(old => old.id !== card.id),
      floor: shown.floor.filter(old => old.id !== card.id),
      drawCount: isDraw ? Math.max(next.drawCount, shown.drawCount - 1) : shown.drawCount,
      players: shown.players.map(player => player.seat === before.turn && !isDraw
        ? { ...player, handCount: Math.max(next.players[player.seat].handCount, player.handCount - 1) } : player) };
    push({ card, kind, faceUp: !faceDown }, isDraw ? GAME_SPEED.drawMove : side === 'player' ? GAME_SPEED.playerPlay : GAME_SPEED.opponentPlay);
    if (faceDown) push({ card, kind, faceUp: true }, GAME_SPEED.revealHold);
    shown = { ...shown, floor: [...shown.floor, card] };
  }
  for (const player of next.players) {
    const cards = player.captured.filter(card => !before.players[player.seat].captured.some(old => old.id === card.id));
    if (!cards.length) continue;
    const ids = new Set(cards.map(card => card.id));
    shown = { ...shown, floor: shown.floor.filter(card => !ids.has(card.id)),
      players: shown.players.map(old => ({ ...old, captured: old.captured.filter(card => !ids.has(card.id)) })) };
    push({ captured: { cards, side: player.seat === you ? 'player' : 'opponent' } }, GAME_SPEED.captureMove);
    shown = { ...shown, players: shown.players.map(old => old.seat === player.seat
      ? { ...old, captured: player.captured, score: player.score } : old) };
  }
  // Finish locations from the authoritative snapshot, including pending choices and ppeok.
  shown = displaySnapshot(next);
  if (newCards.length || before.phase === 'choose' && next.phase !== before.phase) {
    for (const event of next.specialEvents) {
      if (event !== 'shake') push({ effect: getSpecialEventName(event) }, GAME_SPEED.specialEffect);
    }
  }
  push({}, 0);
  return frames;
}

export type PresentationState = { latest: GameView; frames: PresentationFrame[]; index: number };
export function receivePresentation(state: PresentationState, next: GameView, you: Seat): PresentationState {
  if (next.revision <= state.latest.revision) return state;
  // Superseding an unfinished sequence snaps to latest instead of accumulating input locks.
  const frames = state.index < state.frames.length - 1 || next.revision !== state.latest.revision + 1
    ? [{ game: displaySnapshot(next), visual: {}, duration: 0 }] : presentationFrames(state.latest, next, you);
  return { latest: next, frames, index: 0 };
}
export function advancePresentation(state: PresentationState, revision: number): PresentationState {
  return state.latest.revision !== revision ? state : { ...state, index: Math.min(state.index + 1, state.frames.length - 1) };
}
