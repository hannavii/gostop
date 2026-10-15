import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { calculateScore } from '../src/game/scoring';
import { calculateSettlement } from '../src/game/settlement';
import { calculateGostopSettlement } from '../src/game/gostopSettlement';
import { applyAction, gameView } from '../server/game';
import { hwatuCards } from '../src/data/cards';
import MatgoOnlineSettlement from '../src/online/MatgoOnlineSettlement';
import GostopOnlineSettlement from '../src/online/GostopOnlineSettlement';
import { settlementMatch } from './settlement-fixture';

test('engine score contributions sum to total, including chosen sake mode and each named set', () => {
  for (let mask = 0; mask < 256; mask++) {
    const cards = hwatuCards.filter((_, index) => ((mask + 1) * (index + 7)) % 13 < 7);
    const score = calculateScore(cards);
    assert.equal(score.scoreItems.reduce((sum, item) => sum + item.points, 0), score.total);
    assert.ok(score.scoreItems.every(item => item.points > 0));
    assert.equal(new Set(score.scoreItems.map(item => item.id)).size, score.scoreItems.length);
  }
  const score = calculateScore(hwatuCards);
  for (const id of ['gwang', 'animal', 'godori', 'ribbon', 'hongdan', 'cheongdan', 'chodan', 'pi']) {
    assert.ok(score.scoreItems.some(item => item.id === id));
  }
});

test('Matgo UI formats only server contributions, applied multipliers and final payment', () => {
  const match = settlementMatch('matgo'), winner = match.players[0], loser = match.players[1];
  const result = calculateSettlement(winner.captured, loser.captured, winner.goCount, loser.goCount, 1, 1);
  const html = renderToStaticMarkup(createElement(MatgoOnlineSettlement, { settlement: result, winner: '승자', loser: '패자' }));
  for (const item of result.scoreItems!) assert.ok(html.includes(`+${item.points}점`) && html.includes(item.label));
  for (const item of result.multipliers) assert.ok(html.includes(item.label) && html.includes(`×${item.multiplier}`));
  assert.ok(html.includes(`${result.finalScore}점`));
  const plain = calculateSettlement([], [], 0, 0);
  const empty = renderToStaticMarkup(createElement(MatgoOnlineSettlement, { settlement: plain, winner: 'A', loser: 'B' }));
  assert.ok(!empty.includes('적용된 배수와 박') && !empty.includes('피박') && !empty.includes('광박'));
  // Deliberately different metadata proves the component displays values without re-deriving them.
  const authoritative = renderToStaticMarkup(createElement(MatgoOnlineSettlement, { settlement: {
    ...plain, finalScore: 987, scoreItems: [{ id: 'gwang', label: '서버 항목', points: 123 }],
  }, winner: 'A', loser: 'B' }));
  assert.match(authoritative, /987점/); assert.match(authoritative, /서버 항목/); assert.match(authoritative, /\+123점/);
});

test('Gostop UI preserves normal payment, go-bak substitution and actual payer values', () => {
  const match = settlementMatch('gostop');
  const result = calculateGostopSettlement({ winner: 0, players: match.players.map((player, index) => ({
    index: index as 0 | 1 | 2, cards: player.captured, goCount: player.goCount, shakeCount: player.shakeMonths.length, bombCount: player.bombCount,
  })) });
  const html = renderToStaticMarkup(createElement(GostopOnlineSettlement, { settlement: result, name: seat => `친구${seat}` }));
  assert.equal(result.goBakPayer, 1);
  assert.equal(result.loserSettlements[0].payment, result.loserSettlements.reduce((sum, p) => sum + p.normalPayment, 0));
  assert.equal(result.loserSettlements[1].payment, 0);
  for (const payer of result.loserSettlements) {
    assert.ok(html.includes(`${payer.payment}점 부담`));
    assert.ok(html.includes(`대납 전 ${payer.normalPayment}점`));
  }
  assert.match(html, /친구1 고박/); assert.match(html, /친구2의 정산까지 대신 부담/);
  const noBak = { ...result, goBakPayer: null, winnerMultipliers: [], loserSettlements: result.loserSettlements.map(p => ({
    ...p, gwangBak: false, piBak: false, goBak: false, goBakPaidFor: null,
  })) };
  const plain = renderToStaticMarkup(createElement(GostopOnlineSettlement, { settlement: noBak, name: seat => `친구${seat}` }));
  assert.ok(!plain.includes('광박') && !plain.includes('피박') && !plain.includes('고박'));
});

test('finished public views preserve the engine settlement and never expose another hand', () => {
  for (const mode of ['matgo', 'gostop'] as const) {
    const before = settlementMatch(mode);
    const match = applyAction(before, 0, { type: 'stop', revision: before.revision, roomCode: 'ABC123' });
    for (let seat = 0; seat < match.players.length; seat++) {
      const view = gameView(match, seat as 0 | 1 | 2);
      assert.deepEqual(view.result, match.result);
      assert.ok(!('pile' in view) && !('pending' in view));
      assert.ok(view.players.every(player => !('hand' in player)));
      for (const player of match.players.filter((_, index) => index !== seat)) {
        for (const card of player.hand) assert.ok(!JSON.stringify(view).includes(`"${card.id}"`));
      }
    }
  }
});
