import type { GameView, Seat } from '../../shared/online';
import { findSameMonthCards } from '../game/matching';

// Presentation only: permission comes from the viewer-specific server projection.
export function beginnerHighlights(game: GameView, seat: Seat, visible: boolean) {
  const handIds = new Set<string>(), floorIds = new Set<string>();
  if (visible && game.canPlayHand && game.turn === seat && game.phase === 'play') {
    for (const card of game.hand) {
      handIds.add(card.id);
      for (const match of findSameMonthCards(card, game.floor)) floorIds.add(match.id);
    }
  }
  return { handIds, floorIds };
}
