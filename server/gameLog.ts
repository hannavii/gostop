import type { GameAction, GameLogEntry, GameLogEvent, Seat } from '../shared/online';
import type { Match } from './game';

// A 48-card round normally has tens of actions and at most a few hundred entries.
// Keep a generous full-round budget while bounding repeated connection changes.
export const MAX_GAME_LOG_ENTRIES = 256;

export class GameLog {
  entries: GameLogEntry[] = [];
  specialEvents: import('../shared/online').GameResultRecord['specialEvents'] = [];
  private sequence = 0;
  private round = 0;
  constructor(private readonly roomCode: string) {}

  copy() {
    const log = new GameLog(this.roomCode);
    log.entries = [...this.entries];
    log.specialEvents = this.specialEvents.map(event => ({ ...event }));
    log.sequence = this.sequence;
    log.round = this.round;
    return log;
  }

  start(round: number, revision: number) {
    this.round = round; this.sequence = 0; this.entries = []; this.specialEvents = [];
    this.append(revision, { type: 'start', payload: { rematch: round > 1 } });
  }

  append(revision: number, event: GameLogEvent) {
    const type = event.type === 'special' ? event.payload.event : event.type;
    if ('playerSeat' in event && ['bomb', 'shake', 'ppeok', 'jjok', 'ttadak', 'pansseul', 'ppeok-capture', 'self-ppeok-capture'].includes(type)) {
      const existing = this.specialEvents.find(item => item.type === type && item.playerSeat === event.playerSeat);
      if (existing) existing.count++;
      else this.specialEvents.push({ type: type as import('../src/game/gostopTurn').GostopSpecialEvent, playerSeat: event.playerSeat, count: 1 });
    }
    const sequence = ++this.sequence;
    this.entries.push({ ...event, id: `${this.roomCode}:${this.round}:${sequence}`, round: this.round, revision, sequence });
    if (this.entries.length > MAX_GAME_LOG_ENTRIES) this.entries.splice(0, this.entries.length - MAX_GAME_LOG_ENTRIES);
  }

  // Called only after applyAction succeeds; malformed, foreign and replayed actions never reach here.
  action(before: Match, after: Match, seat: Seat, action: GameAction, automatic: boolean) {
    const revision = after.revision;
    if (action.type === 'play' || action.type === 'bomb' || action.type === 'shake' || action.type === 'choose') {
      // Only the committed submitted/selected public card is projected. No candidates, hands or pile.
      const card = action.type === 'choose' ? before.floor.find(card => card.id === action.cardId)
        : before.players[seat].hand.find(card => card.id === action.cardId);
      if (card) this.append(revision, { type: action.type, playerSeat: seat,
        payload: { month: card.month, category: card.category, automatic } });
    } else if (action.type === 'go') {
      this.append(revision, { type: 'go', playerSeat: seat, payload: { automatic, goCount: after.players[seat].goCount } });
    } else {
      this.append(revision, { type: action.type, playerSeat: seat, payload: { automatic } });
    }
    if (action.type !== 'go' && action.type !== 'stop') {
      // play/pass resets the turn event list; choose only adds newly confirmed events.
      const previous = action.type === 'choose' ? before.events : [];
      for (const event of after.events) {
        if (['bomb', 'shake', 'bomb-pass'].includes(event) || previous.includes(event)) continue;
        this.append(revision, { type: 'special', playerSeat: seat, payload: { event } });
      }
    }
    if (before.phase !== 'finished' && after.phase === 'finished' && after.result) {
      this.append(revision, { type: 'finished', payload: { winner: after.result.winner } });
    }
  }
}
