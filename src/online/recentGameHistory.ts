import type { GameResultRecord, RoomView, Seat, SpectatorRoomView } from '../../shared/online';

export const HISTORY_LIMIT = 30;
export const HISTORY_KEY = 'gostop.recent-games.v1';
export type RecentGame = { record: GameResultRecord; you: Seat };
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface GameHistoryRepository { list(): RecentGame[]; add(entry: RecentGame): boolean; clear(): boolean }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const seat = (v: unknown): v is Seat => v === 0 || v === 1 || v === 2;
// Validate every nested field, including settlement arrays, before rendering persisted data.
function publicJson(v: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return number(v);
  if (Array.isArray(v)) return v.length < 100 && v.every(x => publicJson(x, depth + 1));
  return object(v) && Object.entries(v).every(([k, x]) => !/hand|deck|pile|token|socket|pending|timer|captured|cards/i.test(k) && publicJson(x, depth + 1));
}
function settlement(v: unknown, three: boolean): boolean {
  if (v === null) return true;
  if (!object(v) || !publicJson(v)) return false;
  if (!['baseScore', 'goBonus', 'scoreBeforeMultipliers', 'winnerGoCount', 'winnerShakeCount', 'winnerBombCount', ...(three ? ['winnerMultiplier', 'totalReceived'] : ['finalScore', 'totalMultiplier', 'loserGoCount'])].every(k => number(v[k]))) return false;
  const multipliers = v[three ? 'winnerMultipliers' : 'multipliers'];
  if (!Array.isArray(multipliers) || !multipliers.every(x => object(x) && typeof x.id === 'string' && typeof x.label === 'string' && number(x.multiplier))) return false;
  if (v.scoreItems !== undefined && (!Array.isArray(v.scoreItems) || !v.scoreItems.every(x => object(x) && typeof x.id === 'string' && typeof x.label === 'string' && number(x.points)))) return false;
  return !three || seat(v.winner) && (v.goBakPayer === null || seat(v.goBakPayer)) && Array.isArray(v.loserSettlements) && v.loserSettlements.length === 2 && v.loserSettlements.every(x => object(x) && seat(x.loser) && ['payment', 'normalPayment', 'totalMultiplier'].every(k => number(x[k])) && ['gwangBak', 'piBak', 'goBak'].every(k => typeof x[k] === 'boolean') && (x.goBakPaidFor === null || seat(x.goBakPaidFor)));
}
export function validRecentGame(v: unknown): v is RecentGame {
  if (!object(v) || !seat(v.you) || !object(v.record) || !publicJson(v.record)) return false;
  const r = v.record, count = r.mode === 'matgo' ? 2 : r.mode === 'gostop' ? 3 : 0;
  return r.version === 1 && typeof r.id === 'string' && r.id.length > 0 && typeof r.completedAt === 'string' && Number.isFinite(Date.parse(r.completedAt)) && number(r.round) && Number.isInteger(r.round) && r.round > 0 && count > 0 && v.you < count &&
    (r.winnerSeat === 'draw' || seat(r.winnerSeat) && r.winnerSeat < count) &&
    Array.isArray(r.players) && r.players.length === count && r.players.every((p, i) => object(p) && p.seat === i && typeof p.nickname === 'string') &&
    Array.isArray(r.results) && r.results.length === count && r.results.every((p, i) => object(p) && p.seat === i && ['win', 'loss', 'draw'].includes(p.outcome as string) && ['score', 'goCount', 'payment', 'received'].every(k => number(p[k]))) &&
    Array.isArray(r.specialEvents) && r.specialEvents.every(e => object(e) && typeof e.type === 'string' && ['bomb', 'shake', 'ppeok', 'jjok', 'ttadak', 'pansseul', 'ppeok-capture', 'self-ppeok-capture'].includes(e.type) && seat(e.playerSeat) && e.playerSeat < count && number(e.count)) &&
    settlement(r.settlement, false) && settlement(r.gostopSettlement, true);
}
export function createHistoryRepository(storage: () => StoragePort | null = () => typeof localStorage === 'undefined' ? null : localStorage): GameHistoryRepository {
  function list(): RecentGame[] {
    try {
      const data: unknown = JSON.parse(storage()?.getItem(HISTORY_KEY) ?? '[]');
      if (!Array.isArray(data)) return [];
      const seen = new Set<string>();
      return data.filter(validRecentGame).sort((a, b) => Date.parse(b.record.completedAt) - Date.parse(a.record.completedAt)).filter(e => {
        if (seen.has(e.record.id)) return false;
        seen.add(e.record.id); return true;
      }).slice(0, HISTORY_LIMIT);
    } catch { return []; }
  }
  return { list, add(entry) {
    try {
      if (!validRecentGame(entry)) return false;
      const port = storage(); if (!port) return false;
      const entries = list(); if (entries.some(e => e.record.id === entry.record.id)) return true;
      port.setItem(HISTORY_KEY, JSON.stringify([...entries, entry].sort((a, b) => Date.parse(b.record.completedAt) - Date.parse(a.record.completedAt)).slice(0, HISTORY_LIMIT)));
      return true;
    } catch { return false; }
  }, clear() { try { const port = storage(); if (!port) return false; port.removeItem(HISTORY_KEY); return true; } catch { return false; } } };
}
export const recentGameHistory = createHistoryRepository();
export function savePlayerResult(view: RoomView | SpectatorRoomView, repository = recentGameHistory): boolean {
  if ('role' in view || view.you === null || !('completedResult' in view) || !view.completedResult) return true;
  return repository.add({ record: view.completedResult, you: view.you });
}
