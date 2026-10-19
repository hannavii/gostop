import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createMatch } from '../server/game';
import { createGameResult } from '../server/gameResult';
import { GameLog } from '../server/gameLog';
import { settlementMatch } from './settlement-fixture';
import { createHistoryRepository, HISTORY_LIMIT, savePlayerResult, validRecentGame } from '../src/online/recentGameHistory';
import type { RoomView, SpectatorRoomView } from '../shared/online';
function entry(mode: 'matgo' | 'gostop' = 'matgo') {
  const before = settlementMatch(mode);
  const action = { roomCode: 'ABC123', revision: 0, type: 'stop' as const };
  const after = applyAction(before, 0, action);
  const log = new GameLog('ABC123'); log.start(1, 0); log.action(before, after, 0, action, false);
  return { record: createGameResult(after, 1, mode === 'matgo' ? ['A', 'B'] : ['A', 'B', 'C'], log.specialEvents), you: 0 as const };
}
test('exhausted round records authoritative draw without payments', () => {
  const before = createMatch();
  const card = before.players[0].hand[0];
  before.players.forEach(p => { p.hand = []; });
  before.players[0].hand = [card];
  before.pile = []; before.floor = [];
  const after = applyAction(before, 0, { roomCode: 'ABC123', revision: 0, type: 'play', cardId: card.id });
  const record = createGameResult(after, 1, ['A', 'B'], []);
  assert.equal(record.winnerSeat, 'draw');
  assert.equal(record.settlement, null);
  assert.ok(record.results.every(p => p.outcome === 'draw' && p.payment === 0 && p.received === 0));
  assert.equal(validRecentGame({ record, you: 0 }), true);
});
for (const mode of ['matgo', 'gostop'] as const) test(`${mode}: server result preserves engine settlement, outcomes and GO without private data`, () => {
  const e = entry(mode), before = settlementMatch(mode);
  const after = applyAction(before, 0, { roomCode: 'ABC123', revision: 0, type: 'stop' });
  assert.deepEqual(e.record.settlement, after.result!.settlement);
  assert.deepEqual(e.record.gostopSettlement, after.result!.gostopSettlement ?? null);
  assert.equal(e.record.results[0].outcome, 'win');
  e.record.results.slice(1).forEach(p => assert.equal(p.outcome, 'loss'));
  assert.deepEqual(e.record.results.map(p => p.goCount), after.players.map(p => p.goCount));
  if (mode === 'gostop') for (const p of after.result!.gostopSettlement!.loserSettlements) assert.equal(e.record.results[p.loser].payment, p.payment);
  assert.equal(validRecentGame(e), true);
  assert.doesNotMatch(JSON.stringify(e), /hand|deck|pile|token|socket|pending|timer|captured|cards/i);
  assert.notEqual(entry(mode).record.id, e.record.id);
});
test('special summaries survive log truncation and copy without double counting', () => {
  const log = new GameLog('ABC123'); log.start(1, 0);
  log.append(1, { type: 'special', playerSeat: 1, payload: { event: 'ppeok' } });
  const copy = log.copy(); copy.append(2, { type: 'special', playerSeat: 1, payload: { event: 'ppeok' } });
  for (let i = 0; i < 300; i++) copy.append(3, { type: 'disconnect', playerSeat: 0, payload: {} });
  assert.equal(copy.specialEvents[0].count, 2); assert.equal(log.specialEvents[0].count, 1);
  assert.deepEqual(createGameResult(applyAction(settlementMatch('matgo'), 0, { roomCode: 'ABC123', revision: 0, type: 'stop' }), 1, ['A', 'B'], copy.specialEvents).specialEvents, copy.specialEvents);
});
test('repository ordering, limit, dedupe, corrupt input, clear and storage failures', () => {
  let value = 'invalid';
  const repository = createHistoryRepository(() => ({ getItem: () => value, setItem: (_k, v) => { value = v; }, removeItem: () => { value = '[]'; } }));
  assert.deepEqual(repository.list(), []);
  for (const bad of ['null', '{}', '[{}]', '[{"record":null}]']) { value = bad; assert.deepEqual(repository.list(), []); }
  const e = entry();
  for (let i = 0; i < 40; i++) repository.add({ ...e, record: { ...e.record, id: String(i), completedAt: new Date(1000 * i).toISOString() } });
  assert.equal(repository.list().length, HISTORY_LIMIT); assert.equal(repository.list()[0].record.id, '39');
  const latest = repository.list()[0]; repository.add(latest); assert.equal(repository.list().length, HISTORY_LIMIT);
  const broken = structuredClone(e) as unknown as { record: { settlement: { multipliers: unknown } } }; broken.record.settlement.multipliers = null;
  value = JSON.stringify([broken, e]); assert.equal(repository.list().length, 1);
  assert.equal(repository.clear(), true); assert.deepEqual(repository.list(), []);
  const failed = createHistoryRepository(() => { throw new Error('denied'); });
  assert.deepEqual(failed.list(), []); assert.equal(failed.add(e), false); assert.equal(failed.clear(), false);
  const quota = createHistoryRepository(() => ({ getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem() {} }));
  assert.equal(quota.add(e), false);
});
test('only participating player views are stored; repeated finished snapshots dedupe', () => {
  let value = '[]'; const repository = createHistoryRepository(() => ({ getItem: () => value, setItem: (_k, v) => { value = v; }, removeItem() {} }));
  const e = entry(); const view = { you: 1, completedResult: e.record } as RoomView;
  savePlayerResult(view, repository); savePlayerResult(view, repository);
  assert.equal(repository.list().length, 1); assert.equal(repository.list()[0].you, 1);
  savePlayerResult({ ...view, role: 'spectator', you: null } as unknown as SpectatorRoomView, repository);
  assert.equal(repository.list().length, 1);
});
