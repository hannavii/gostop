import type { GameAction, Seat, TurnTimerView } from '../shared/online';
import { gameView, type Match } from './game';
import { presentationFrames } from '../src/online/presentation';

export const TURN_TIMEOUT_MS = 30_000;

// Reuse the viewer-specific legal permission, including mandatory Matgo bomb passes.
export function timeoutAction(match: Match, roomCode: string): GameAction {
  const view = gameView(match, match.turn);
  const first = (cards: typeof view.hand) => [...cards].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0]?.id;
  const base = { roomCode, revision: match.revision };
  if (match.phase === 'go-stop') return { ...base, type: 'stop' };
  if (match.phase === 'choose') return { ...base, type: 'choose', cardId: first(view.choice!) };
  if (match.phase !== 'play') throw new Error('No active decision');
  if (!view.canPlayHand || !view.hand.length) return { ...base, type: 'bomb-pass' };
  return { ...base, type: 'play', cardId: first(view.hand) };
}

export class TurnTimer {
  view: TurnTimerView | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private previous: Match | null = null;
  private current: Match | null = null;
  fallback = timeoutAction;

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.view = null;
    this.current = null;
    this.generation++;
  }

  sync(match: Match | null, connected: boolean[], expire: () => void) {
    if (!match || match.phase === 'finished' || !connected[match.turn]) {
      this.cancel();
      this.previous = match;
      return;
    }
    if (this.current === match && this.view) return;
    const before = this.previous;
    this.cancel();
    // Both viewers use the same sequence, but opponent reveals can take longer.
    // Budget the longest sequence on the server, never a client readiness signal.
    const animationMs = before && match.revision === before.revision + 1
      ? Math.max(...match.players.map((_, seat) => presentationFrames(gameView(before, seat as Seat),
        gameView(match, seat as Seat), seat as Seat).reduce((sum, frame) => sum + frame.duration, 0))) : 0;
    const startsAt = Date.now() + animationMs;
    const expected = this.generation;
    this.current = match;
    this.previous = match;
    this.view = { startsAt, turnDeadline: startsAt + TURN_TIMEOUT_MS,
      timedPlayerSeat: match.turn, decisionPhase: match.phase };
    this.timer = setTimeout(() => {
      if (expected !== this.generation || this.current !== match || !this.view ||
        this.view.timedPlayerSeat !== match.turn || this.view.decisionPhase !== match.phase) return;
      this.cancel();
      expire();
    }, animationMs + TURN_TIMEOUT_MS);
    this.timer.unref();
  }
}
