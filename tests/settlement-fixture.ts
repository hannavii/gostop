import { createMatch } from '../server/game';
import { hwatuCards } from '../src/data/cards';
import type { GameMode } from '../src/game/rules';

// A public, deterministic late-game fixture. STOP still runs the real settlement engine.
export function settlementMatch(mode: GameMode) {
  const match = createMatch(mode);
  const pi = hwatuCards.filter(card => card.category === 'pi');
  const winnerCards = [...hwatuCards.filter(card => card.category !== 'pi'), ...pi.slice(0, 12)];
  match.players[0].captured = winnerCards;
  match.players[0].goCount = 3;
  match.players[0].shakeMonths = [1];
  match.players[0].bombCount = 1;
  match.players.slice(1).forEach((player, index) => { player.captured = [pi[12 + index]]; });
  match.players[1].goCount = 1;
  const used = new Set(match.players.flatMap(player => player.captured.map(card => card.id)));
  const remaining = hwatuCards.filter(card => !used.has(card.id));
  match.players.forEach((player, index) => { player.hand = [remaining[index]]; });
  match.floor = remaining.slice(match.players.length, match.players.length + 3);
  match.pile = remaining.slice(match.players.length + 3);
  match.phase = 'go-stop';
  return match;
}
