import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TurnTimer, TURN_TIMEOUT_MS, timeoutAction } from '../turnTimer';
import { applyAction, createMatch, gameView } from '../game';
import { hwatuCards } from '../../src/data/cards';

for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: authoritative deadlines, automatic play, stale timers, disconnect and rematch`, t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const timer = new TurnTimer();
    let match = createMatch(mode), calls = 0;
    const connections = match.players.map(() => true);
    const sync = () => timer.sync(match, connections, () => {
      calls++;
      match = applyAction(match, match.turn, timeoutAction(match, 'ABC123'));
      sync();
    });
    sync();
    assert.equal(timer.view!.turnDeadline, 1000 + TURN_TIMEOUT_MS);
    t.mock.timers.tick(TURN_TIMEOUT_MS - 1); assert.equal(calls, 0);
    t.mock.timers.tick(1); assert.equal(calls, 1); assert.equal(match.revision, 1);
    // A sync snapshot neither extends nor duplicates the existing timer.
    const deadline = timer.view!.turnDeadline;
    sync(); assert.equal(timer.view!.turnDeadline, deadline);
    connections[match.turn] = false; sync(); assert.equal(timer.view, null);
    t.mock.timers.tick(100_000); assert.equal(calls, 1);
    connections[match.turn] = true; sync();
    assert.equal(timer.view!.turnDeadline, Date.now() + TURN_TIMEOUT_MS);
    const old = match;
    match = createMatch(mode); match.revision = old.revision + 1; sync();
    t.mock.timers.tick(TURN_TIMEOUT_MS - 1); assert.equal(calls, 1);
    timer.cancel(); t.mock.timers.tick(100_000); assert.equal(calls, 1);
    match.phase = 'finished'; sync(); assert.equal(timer.view, null);
    t.mock.timers.reset();
  });

  test(`${mode}: fallback completes turns, matching, STOP and ordinary special-option play`, () => {
    let match = createMatch(mode);
    let turns = 0;
    for (let i = 0; i < 200 && match.phase !== 'finished'; i++) {
      const previous = match.turn;
      const move = timeoutAction(match, 'ABC123');
      assert.ok(!['bomb', 'shake', 'go'].includes(move.type));
      match = applyAction(match, match.turn, move);
      if (match.turn !== previous) turns++;
      for (let seat = 0; seat < match.players.length; seat++) {
        const view = gameView(match, seat as 0 | 1 | 2);
        assert.ok(view.players.every(player => !('hand' in player)));
        assert.ok(!('pile' in view) && !('pending' in view));
      }
    }
    assert.ok(turns > 0); assert.equal(match.phase, 'finished');
    match = createMatch(mode); match.phase = 'go-stop';
    assert.equal(timeoutAction(match, 'ABC123').type, 'stop');
    assert.equal(applyAction(match, 0, timeoutAction(match, 'ABC123')).phase, 'finished');
    match = createMatch(mode);
    const cards = hwatuCards.filter(card => card.month === 1);
    match.players[0].hand = cards.slice(0, 3); match.floor = cards.slice(3);
    assert.equal(timeoutAction(match, 'ABC123').type, 'play');
    match.floor = [];
    assert.equal(timeoutAction(match, 'ABC123').type, 'play');
    match.phase = 'choose'; match.pending = { kind: 'hand', card: cards[0], matches: cards.slice(1, 3) };
    assert.equal(timeoutAction(match, 'ABC123').cardId, [...cards.slice(1, 3)].sort((a,b) => a.id.localeCompare(b.id))[0].id);
    assert.throws(() => applyAction(match, 0, { roomCode: 'ABC123', revision: match.revision, type: 'timeout' } as never));
  });

  test(`${mode}: manual input invalidates old deadline and each matching decision gets full time`, t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
    const timer = new TurnTimer();
    let match = createMatch(mode), calls = 0;
    const connected = match.players.map(() => true);
    timer.sync(match, connected, () => calls++);
    t.mock.timers.tick(10_000);
    match = applyAction(match, match.turn, timeoutAction(match, 'ABC123'));
    timer.sync(match, connected, () => calls++);
    assert.equal(timer.view!.turnDeadline - timer.view!.startsAt, TURN_TIMEOUT_MS);
    t.mock.timers.tick(20_000); assert.equal(calls, 0);
    // A pending hand choice remains server-owned and deterministic.
    const choice = createMatch(mode), cards = hwatuCards.filter(card => card.month === 1);
    choice.phase = 'choose'; choice.floor = cards.slice(1, 3); choice.players[0].hand = [];
    choice.pending = { kind: 'hand', card: cards[0], matches: choice.floor };
    choice.revealed = [cards[0]];
    timer.sync(choice, connected, () => {
      calls++;
      match = applyAction(choice, choice.turn, timeoutAction(choice, 'ABC123'));
    });
    t.mock.timers.tick(TURN_TIMEOUT_MS - 1); assert.equal(calls, 0);
    t.mock.timers.tick(1); assert.equal(calls, 1); assert.equal(match.revision, choice.revision + 1);
    t.mock.timers.tick(100_000); assert.equal(calls, 1);
    timer.sync(null, connected, () => calls++); assert.equal(timer.view, null);
    t.mock.timers.reset();
  });

  test(`${mode}: GO/STOP expiration stops and finished/rematch states cannot reuse callback`, t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
    const timer = new TurnTimer();
    let match = createMatch(mode), calls = 0;
    match.phase = 'go-stop';
    const connected = match.players.map(() => true);
    timer.sync(match, connected, () => {
      calls++;
      match = applyAction(match, match.turn, timeoutAction(match, 'ABC123'));
      timer.sync(match, connected, () => calls++);
    });
    t.mock.timers.tick(TURN_TIMEOUT_MS);
    assert.equal(match.phase, 'finished'); assert.equal(timer.view, null);
    t.mock.timers.tick(TURN_TIMEOUT_MS); assert.equal(calls, 1);
    match = createMatch(mode); match.revision = 2;
    timer.sync(match, connected, () => calls++);
    assert.equal(timer.view!.turnDeadline, Date.now() + TURN_TIMEOUT_MS);
    timer.cancel(); t.mock.timers.tick(TURN_TIMEOUT_MS); assert.equal(calls, 1);
    t.mock.timers.reset();
  });
}
