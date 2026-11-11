import type { GameView, Seat } from '../../shared/online';
import { findSameMonthCards } from '../game/matching';

// Presentation only: permission comes from the viewer-specific server projection.
export function beginnerHighlights(game: GameView, seat: Seat, visible: boolean) {
  const handIds = new Set<string>(), floorIds = new Set<string>();
  if (visible && game.canPlayHand && game.turn === seat && game.phase === 'play') {
    for (const card of game.hand) {
      const matches = findSameMonthCards(card, game.floor);
      if (matches.length === 0) continue;
      handIds.add(card.id);
      for (const match of matches) floorIds.add(match.id);
    }
    // With no matching hand, show all playable cards as the fallback.
    if (handIds.size === 0) for (const card of game.hand) handIds.add(card.id);
  }
  return { handIds, floorIds };
}
