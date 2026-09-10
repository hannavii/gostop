import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// Regression tests for the project's adopted house rule: stack pi rewards when
// pansseul and other pi-reward events occur in the same turn.
// Overlap assertions verify this house rule, not official service rules.

// Run the existing TypeScript sources directly with Node 24, without new dependencies.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/src/')) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return nextResolve(url.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const [matgo, gostop, scoring, settlement, gostopSettlement] = await Promise.all([
  import('../src/game/turn.ts'),
  import('../src/game/gostopTurn.ts'),
  import('../src/game/scoring.ts'),
  import('../src/game/settlement.ts'),
  import('../src/game/gostopSettlement.ts'),
]);

const card = (month, cardIndex, category = 'pi', tags = []) => ({
  id: `${month}-${cardIndex}`, month, cardIndex, category, tags,
});
const modes = [
  {
    name: 'matgo', owners: ['player', 'opponent'],
    prepare: matgo.prepareHandPlay, draw: matgo.resolveTurnDraw,
    drawOnly: matgo.resolveDrawOnly, choice: matgo.resolveDrawChoice,
    finalize: matgo.finalizePreparedPlay, sweep: matgo.applyPansseul,
    steal: matgo.stealPiCards, bomb: matgo.getBombActionForMonth,
    shake: matgo.canShakeMonth,
  },
  {
    name: 'gostop', owners: [0, 1, 2],
    prepare: gostop.prepareGostopHandPlay, draw: gostop.resolveGostopTurnDraw,
    drawOnly: gostop.resolveGostopDrawOnly, choice: gostop.resolveGostopDrawChoice,
    finalize: gostop.finalizeGostopPreparedPlay, sweep: gostop.applyGostopPansseul,
    steal: gostop.stealGostopPiCards, bomb: gostop.getGostopBombActionForMonth,
    shake: gostop.canGostopShakeMonth,
  },
];

for (const mode of modes) {
  for (const owner of mode.owners) {
    const label = `${mode.name}/${owner}`;
    const other = mode.owners.find(value => value !== owner);
    const resolve = (floor, played, drawn, stacks = []) => {
      let hand = mode.prepare(played, floor, owner, stacks);
      if (hand.type === 'choice') {
        hand = mode.prepare(played, floor, owner, stacks, hand.matchingCards[0].id);
      }
      assert.equal(hand.type, 'ready');
      return mode.draw(hand.prepared, drawn);
    };

    test(`${label}: normal sweep, immutable and idempotent`, () => {
      const result = resolve([card(1, 1), card(2, 1)], card(1, 2), card(2, 2));
      const original = structuredClone(result);
      const completed = mode.sweep(result, 3);
      assert.deepEqual(completed.specialEvents, ['pansseul']);
      assert.equal(completed.stealPi, 1);
      assert.equal(completed.capturedCards.length, 4);
      assert.deepEqual(result, original);
      assert.strictEqual(mode.sweep(completed, 3), completed);
    });

    test(`${label}: empty starting floor plus jjok awards both events`, () => {
      const completed = mode.sweep(resolve([], card(1, 1), card(1, 2)), 2);
      assert.deepEqual(completed.specialEvents, ['jjok', 'pansseul']);
      assert.equal(completed.stealPi, 2);
    });

    test(`${label}: ttadak plus sweep`, () => {
      const completed = mode.sweep(
        resolve([card(1, 1), card(1, 2)], card(1, 3), card(1, 4)), 2
      );
      assert.deepEqual(completed.specialEvents, ['ttadak', 'pansseul']);
      assert.equal(completed.stealPi, 2);
      assert.equal(completed.capturedCards.length, 4);
    });

    for (const stackOwner of [owner, other]) {
      test(`${label}: ${stackOwner === owner ? 'self' : 'other'} ppeok capture plus sweep`, () => {
        const completed = mode.sweep(resolve(
          [card(1, 1), card(1, 2), card(1, 3), card(2, 1)],
          card(1, 4), card(2, 2), [{ month: 1, owner: stackOwner }]
        ), 2);
        assert.deepEqual(completed.specialEvents, [
          stackOwner === owner ? 'self-ppeok-capture' : 'ppeok-capture', 'pansseul',
        ]);
        assert.equal(completed.stealPi, stackOwner === owner ? 3 : 2);
        assert.deepEqual(completed.ppeokStacks, []);
      });
    }

    test(`${label}: ppeok leaves three cards and never sweeps`, () => {
      const result = resolve([card(1, 1)], card(1, 2), card(1, 3));
      assert.strictEqual(mode.sweep(result, 2), result);
      assert.deepEqual(result.specialEvents, ['ppeok']);
      assert.equal(result.floorCards.length, 3);
      assert.equal(result.capturedCards.length, 0);
      assert.deepEqual(result.ppeokStacks, [{ month: 1, owner }]);
    });

    test(`${label}: temporary empty floor is not a sweep if draw leaves a card`, () => {
      const result = resolve([card(1, 1)], card(1, 2), card(2, 1));
      assert.strictEqual(mode.sweep(result, 2), result);
      assert.deepEqual(result.specialEvents, []);
      assert.equal(result.floorCards[0].month, 2);
    });

    test(`${label}: draw choice stays pending and final selection leaves a floor card`, () => {
      const pending = resolve(
        [card(1, 1), card(2, 1), card(2, 2)], card(1, 2), card(2, 3)
      );
      assert.equal(pending.type, 'choice');
      for (const selected of pending.matchingCards) {
        const result = mode.choice(pending, selected);
        assert.equal(result.floorCards.length, 1);
        assert.strictEqual(mode.sweep(result, 2), result);
        assert.equal(result.capturedCards.length, 4);
      }
    });

    test(`${label}: bomb only awards sweep after the draw clears the remaining floor`, () => {
      const floor = [card(1, 4), card(2, 1)];
      const hand = [card(1, 1), card(1, 2), card(1, 3)];
      const bomb = mode.bomb(hand, floor, 1);
      assert.ok(bomb);
      const remainingFloor = floor.filter(c => c.id !== bomb.floorCard.id);
      // UI applies the bomb's capture/one pi first, then resolves the draw separately.
      const completed = mode.sweep(mode.drawOnly(card(2, 2), remainingFloor, owner, []), 2);
      assert.deepEqual(completed.specialEvents, ['pansseul']);
      assert.equal(1 + completed.stealPi, 2);
      const missed = mode.drawOnly(card(3, 1), remainingFloor, owner, []);
      assert.strictEqual(mode.sweep(missed, 2), missed);
      const bombClearedFloor = mode.drawOnly(card(2, 2), [], owner, []);
      assert.strictEqual(mode.sweep(bombClearedFloor, 2), bombClearedFloor);
    });

    test(`${label}: bomb pass can sweep and remaining passes count as future turns`, () => {
      const result = mode.drawOnly(card(1, 2), [card(1, 1)], owner, []);
      assert.equal(mode.sweep(result, 1).stealPi, 1);
      assert.equal(mode.sweep(result, 0).stealPi, 0);
      assert.deepEqual(mode.sweep(result, 0).specialEvents, ['pansseul']);
    });

    test(`${label}: own last turn adds no sweep reward, preserves existing event rewards`, () => {
      const result = resolve([], card(1, 1), card(1, 2));
      const completed = mode.sweep(result, 0);
      assert.deepEqual(completed.specialEvents, ['jjok', 'pansseul']);
      assert.equal(completed.stealPi, result.stealPi);
      const hand = mode.prepare(card(1, 2), [card(1, 1)], owner, []);
      const noDraw = mode.sweep(mode.finalize(hand.prepared), 0);
      assert.equal(noDraw.stealPi, 0);
    });

    test(`${label}: no capture means no sweep; shake detection stays unchanged`, () => {
      const empty = {
        type: 'complete', floorCards: [], capturedCards: [],
        specialEvents: [], stealPi: 0, ppeokStacks: [],
      };
      assert.strictEqual(mode.sweep(empty, 3), empty);
      const hand = [card(1, 1), card(1, 2), card(1, 3)];
      assert.equal(mode.shake(hand, [], 1), true);
      assert.equal(mode.shake(hand, [card(1, 4)], 1), false);
    });

    test(`${label}: steal from each opponent, including insufficient pi and double pi`, () => {
      const normal = card(3, 1);
      const double = card(4, 1, 'pi', ['double-pi']);
      const bright = card(5, 1, 'gwang');
      for (const opponent of mode.owners.filter(value => value !== owner)) {
        assert.notEqual(opponent, owner);
        const single = mode.steal([bright, double, normal], 1);
        assert.deepEqual(single.stolenCards, [normal]);
        const fallback = mode.steal([bright, double], 1);
        assert.deepEqual(fallback.stolenCards, [double]);
        assert.equal(fallback.stolenPiValue, 2);
        assert.deepEqual(mode.steal([bright], 1).stolenCards, []);
        assert.equal(mode.steal([normal], 3).stolenPiValue, 1);
      }
    });
  }
}

test('sweep pi reaches matgo GO/STOP threshold and is used by settlement', () => {
  const captured = Array.from({ length: 15 }, (_, i) => card(20 + i, 1));
  const stolen = matgo.stealPiCards([card(40, 1)], 1);
  assert.equal(scoring.calculateScore(captured).total, 6);
  const winner = [...captured, ...stolen.stolenCards];
  assert.equal(scoring.calculateScore(winner).total, 7);
  const result = settlement.calculateSettlement(winner, stolen.remainingCards, 1, 0);
  assert.equal(result.baseScore, 7);
  assert.equal(result.goBonus, 1);
  assert.equal(result.finalScore, 16);
});

test('3-player sweep reaches GO/STOP threshold; gobak still pays for the other loser', () => {
  const captured = Array.from({ length: 10 }, (_, i) => card(20 + i, 1));
  const losers = [[card(40, 1)], [card(41, 1)]];
  const transfers = losers.map(cards => gostop.stealGostopPiCards(cards, 1));
  const winner = [...captured, ...transfers.flatMap(result => result.stolenCards)];
  assert.equal(scoring.calculateScore(captured).total, 1);
  assert.equal(scoring.calculateScore(winner).total, 3);
  const players = [winner, ...transfers.map(result => result.remainingCards)].map((cards, index) => ({
    index, cards, goCount: index === 1 ? 1 : 0, shakeCount: 0, bombCount: 0,
  }));
  const result = gostopSettlement.calculateGostopSettlement({ winner: 0, players });
  assert.equal(result.baseScore, 3);
  assert.equal(result.goBakPayer, 1);
  assert.equal(result.loserSettlements[0].payment, 12);
  assert.equal(result.loserSettlements[1].payment, 0);
  assert.equal(result.totalReceived, 12);
  assert.equal(winner.length, captured.length + losers.flat().length);
});
