import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beginnerHighlights } from '../src/online/beginnerHelp';
import { createMatch, gameView } from '../server/game';
import { hwatuCards } from '../src/data/cards';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import OnlineGameBoard from '../src/online/OnlineGameBoard';
import MatgoTable from '../src/components/MatgoTable';
import type { RoomView } from '../shared/online';
import { validateCreateRoom } from '../server/validation';
import { findSameMonthCards } from '../src/game/matching';

const request = { mode: 'matgo', nickname: 'Host', visibility: 'private' };
test('creation defaults false, accepts booleans and rejects malformed settings', () => {
  assert.equal(validateCreateRoom(request).beginnerHelpEnabled, false);
  for (const visibility of ['public', 'private']) {
    for (const beginnerHelpEnabled of [true, false]) assert.equal(validateCreateRoom({ ...request, visibility, beginnerHelpEnabled }).beginnerHelpEnabled, beginnerHelpEnabled);
  }
  for (const beginnerHelpEnabled of [null, 'true', 1, [], {}]) assert.throws(() => validateCreateRoom({ ...request, beginnerHelpEnabled }));
  assert.throws(() => validateCreateRoom({ ...request, extra: true }));
});
for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: matching hands take priority; unmatched hands are the fallback; candidates are deduplicated`, () => {
    const match = createMatch(mode);
    const floor = [hwatuCards[1], hwatuCards[2], hwatuCards[9], hwatuCards[16]];
    match.floor = floor;
    for (const hand of [
      [hwatuCards[24], hwatuCards[28], hwatuCards[32]],
      [hwatuCards[0], hwatuCards[24]],
      [hwatuCards[0], hwatuCards[24], hwatuCards[8], hwatuCards[3]],
    ]) {
      match.players[0].hand = hand;
      const game = gameView(match, 0), before = JSON.stringify(game);
      const help = beginnerHighlights(game, 0, true);
      const matchingHands = hand.filter(card => findSameMonthCards(card, floor).length > 0);
      assert.deepEqual([...help.handIds], (matchingHands.length ? matchingHands : hand).map(card => card.id));
      const expected = new Set(hand.flatMap(card => findSameMonthCards(card, floor).map(candidate => candidate.id)));
      assert.deepEqual(help.floorIds, expected);
      if (matchingHands.length === 0) assert.equal(help.floorIds.size, 0);
      else {
        assert.equal(help.handIds.has(hwatuCards[24].id), false);
        assert.deepEqual([...help.floorIds], floor.slice(0, hand.length === 2 ? 2 : 3).map(card => card.id));
      }
      assert.equal(JSON.stringify(game), before);
    }
  });
  test(`${mode}: highlights authoritative hand and all matching public floor cards without mutation`, () => {
    const match = createMatch(mode);
    match.players[0].hand = [hwatuCards[0]];
    match.floor = hwatuCards.slice(1, 5);
    const game = gameView(match, 0), before = JSON.stringify(game);
    const help = beginnerHighlights(game, 0, true);
    assert.deepEqual([...help.handIds], [hwatuCards[0].id]);
    assert.deepEqual([...help.floorIds], hwatuCards.slice(1, 4).map(c => c.id));
    for (const visible of [false, true]) {
      for (const phase of ['choose', 'go-stop', 'finished'] as const) {
        const hidden = beginnerHighlights({ ...game, phase }, 0, visible);
        assert.equal(hidden.handIds.size, 0);
        assert.equal(hidden.floorIds.size, 0);
      }
    }
    for (const hidden of [beginnerHighlights(game, 0, false), beginnerHighlights(game, 1, true), beginnerHighlights({ ...game, canPlayHand: false }, 0, true)]) {
      assert.equal(hidden.handIds.size, 0); assert.equal(hidden.floorIds.size, 0);
    }
    assert.equal(JSON.stringify(game), before);
    const spectator = gameView(match, null);
    assert.equal(spectator.hand.length, 0); assert.equal(spectator.canPlayHand, false);
    assert.equal(beginnerHighlights(spectator, 0, true).handIds.size, 0);
    assert.ok(!('pile' in spectator) && !('pending' in spectator));
  });
}


test('room permission controls toggle presence; help initially off', () => {
  const game = gameView(createMatch(), 0);
  const room: RoomView = { code: 'ABC123', mode: 'matgo', capacity: 2, you: 0, occupancy: 2, host: 0, round: 1, game,
    connections: [0, 1].map(seat => ({ seat: seat as 0 | 1, nickname: `Player${seat}`, ready: true, rematchReady: false, connected: true, reconnectDeadline: null })) };
  for (const beginnerHelpEnabled of [false, true]) {
    const html = renderToStaticMarkup(createElement(OnlineGameBoard, { room: { ...room, beginnerHelpEnabled }, game, enabled: true,
      message: '', act() {}, onRematch() {}, onSync() {}, onLeave() {} }));
    assert.equal(html.includes('aria-pressed="false"'), beginnerHelpEnabled);
    assert.ok(!html.includes('help-highlight'));
  }
});

test('ppeok grouped and expanded cards receive presentation-only help', () => {
  const cards = hwatuCards.slice(0, 3);
  const html = renderToStaticMarkup(createElement(MatgoTable, {
    floorCards: cards, ppeokStacks: [{ month: 1, owner: 'player' }], expandedPpeokMonth: 1,
    setExpandedPpeokMonth() {}, pendingChoice: null, gameStarted: true, gameOver: false,
    isAnimating: false, turnMessage: '', drawCount: 10, handleFloorCardChoice() {},
    helpFloorIds: new Set(cards.map(c => c.id)),
  }));
  assert.equal((html.match(/help-highlight/g) ?? []).length, 6);
  assert.ok(!html.includes('selectable'));
});
