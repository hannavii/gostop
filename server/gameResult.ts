import { randomUUID } from 'node:crypto';
import type { GameResultRecord, Seat } from '../shared/online';
import { calculateScore } from '../src/game/scoring';
import type { Match } from './game';

// Explicit projection: never spread Match, members, cards or private state.
export function createGameResult(match: Match, round: number, nicknames: string[], specialEvents: GameResultRecord['specialEvents']): GameResultRecord {
  if (match.phase !== 'finished' || !match.result) throw new Error('Match is not finished');
  const { winner, settlement, gostopSettlement } = match.result;
  return {
    version: 1, id: randomUUID(), completedAt: new Date().toISOString(), mode: match.mode, round,
    players: nicknames.map((nickname, seat) => ({ seat: seat as Seat, nickname })),
    winnerSeat: winner,
    results: match.players.map((p, index) => {
      const seat = index as Seat;
      return { seat, outcome: winner === 'draw' ? 'draw' : winner === seat ? 'win' : 'loss',
        score: calculateScore(p.captured).total, goCount: p.goCount,
        payment: winner === 'draw' || winner === seat ? 0 : gostopSettlement?.loserSettlements.find(l => l.loser === seat)?.payment ?? settlement?.finalScore ?? 0,
        received: winner === seat ? gostopSettlement?.totalReceived ?? settlement?.finalScore ?? 0 : 0 };
    }),
    specialEvents: specialEvents.map(({ type, playerSeat, count }) => ({ type, playerSeat, count })),
    settlement: structuredClone(settlement), gostopSettlement: structuredClone(gostopSettlement ?? null),
  };
}
