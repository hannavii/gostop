import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMatch, gameView } from '../server/game';
import { hwatuCards } from '../src/data/cards';
import { GAME_SPEED } from '../src/components/matgoSpeed';
import { presentationFrames, receivePresentation, advancePresentation } from '../src/online/presentation';
import { acceptRoomState, boardPresentationKey } from '../src/online/roomState';
import type { GameView, RoomView } from '../shared/online';

for (const mode of ['matgo', 'gostop'] as const) {
  test(`${mode}: play / reveal / capture use speed boundaries without duplicate locations`, () => {
    const before = gameView(createMatch(mode), 0);
    const played = before.hand[0];
    const drawn = hwatuCards.find(card => !before.hand.some(c => c.id === card.id) && !before.floor.some(c => c.id === card.id))!;
    const floor = before.floor[0];
    const next: GameView = { ...before, revision: before.revision + 1, hand: before.hand.slice(1),
      revealed: [played, drawn], floor: before.floor.slice(1), drawCount: before.drawCount - 1,
      players: before.players.map(p => p.seat === 0 ? { ...p, captured: [played, drawn, floor], handCount: p.handCount - 1 } : p) };
    const frames = presentationFrames(before, next, 0);
    assert.equal(frames[0].duration, GAME_SPEED.playerPlay);
    assert.equal(frames[0].game.floor.some(c => c.id === played.id), false);
    assert.equal(frames[0].game.hand.some(c => c.id === played.id), false);
    assert.equal(frames[1].duration, GAME_SPEED.drawMove);
    assert.ok(frames[1].game.floor.some(c => c.id === played.id));
    assert.equal(frames[1].game.floor.some(c => c.id === drawn.id), false);
    assert.equal(frames[2].duration, GAME_SPEED.revealHold);
    const capture = frames.find(f => f.visual.captured)!;
    assert.equal(capture.duration, GAME_SPEED.captureMove);
    assert.equal(capture.game.players[0].captured.length, 0);
    for (const frame of frames) {
      const locations = [...frame.game.hand, ...frame.game.floor, ...frame.game.players.flatMap(p => p.captured),
        ...(frame.visual.card ? [frame.visual.card] : []), ...(frame.visual.captured?.cards ?? [])];
      assert.equal(new Set(locations.map(c => c.id)).size, locations.length);
      assert.ok(frame.game.players.every(p => !('hand' in p)));
    }
    assert.equal(frames.at(-1)!.game, next);
    assert.equal(frames.at(-1)!.game.players[0].captured.length, 3);
  });
  test(`${mode}: superseding revisions cancel old sequence; stale completion cannot overwrite latest`, () => {
    const before = gameView(createMatch(mode), 0);
    const next = { ...before, revision: 1, revealed: [before.hand[0]], hand: before.hand.slice(1) };
    const initial = { latest: before, frames: [{ game: before, visual: {}, duration: 0 }], index: 0 };
    const active = receivePresentation(initial, next, 0);
    const newest = { ...next, revision: 2 };
    const received = receivePresentation(active, newest, 0);
    assert.equal(received.frames[0].game, newest);
    assert.equal(received.frames[0].duration, 0);
    assert.equal(advancePresentation(received, 1), received);
    assert.equal(receivePresentation(received, next, 0), received);
    assert.equal(receivePresentation(active, { ...next }, 0), active);
  });
  test(`${mode}: special events, choices and GO/STOP never replay completed reveals`, () => {
    const before = gameView(createMatch(mode), 0);
    for (const event of ['ppeok', 'jjok', 'ttadak', 'pansseul', 'bomb', 'shake', 'bomb-pass'] as const) {
      const next = { ...before, revision: 1, revealed: before.hand.slice(0, event === 'bomb' ? 2 : 1), specialEvents: [event] };
      const frames = presentationFrames(before, next, 0);
      assert.equal(frames.at(-1)!.game, next);
      assert.equal(frames[0].visual.kind?.endsWith('draw'), event === 'bomb-pass');
      const go = { ...next, revision: 2, phase: 'go-stop' as const };
      assert.equal(presentationFrames(next, go, 0).length, 1);
    }
    const shaken = { ...before, revision: 1, players: before.players.map(p => p.seat === 0 ? { ...p, shakeMonths: [1] } : p) };
    assert.equal(presentationFrames(before, shaken, 0)[0].duration, GAME_SPEED.shakeReveal);
    const choose = { ...before, revision: 1, phase: 'choose' as const, choice: before.floor.slice(0, 2), revealed: [before.hand[0]] };
    assert.equal(presentationFrames(before, choose, 0).at(-1)!.game.choice, choose.choice);
  });
}

test('GAME_SPEED timer boundaries keep destination hidden until the movement completes', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const before = gameView(createMatch('matgo'), 0);
  const card = before.hand[0];
  const next = { ...before, revision: 1, hand: before.hand.slice(1), revealed: [card], floor: [...before.floor, card] };
  let state = receivePresentation({ latest: before, frames: [{ game: before, visual: {}, duration: 0 }], index: 0 }, next, 0);
  const timer = setTimeout(() => { state = advancePresentation(state, next.revision); }, state.frames[0].duration);
  t.mock.timers.tick(GAME_SPEED.playerPlay - 1);
  assert.ok(!state.frames[state.index].game.floor.some(c => c.id === card.id));
  assert.equal(state.frames[state.index].visual.card?.id, card.id);
  t.mock.timers.tick(1);
  assert.ok(state.frames[state.index].game.floor.some(c => c.id === card.id));
  assert.equal(state.frames[state.index].visual.card, undefined);
  clearTimeout(timer);
});


test('new round resets presentation identity while stale old snapshots cannot restore it', () => {
  const game = gameView(createMatch('matgo'), 0);
  const first: RoomView = { code: 'ABC123', round: 1, mode: 'matgo', host: 0, you: 0, capacity: 2, occupancy: 2, connections: [], game: { ...game, revision: 10 } };
  const consent = { ...first, connections: [{ seat: 0 as const, nickname: 'Host', ready: true, rematchReady: true, connected: true, reconnectDeadline: null }] };
  assert.equal(boardPresentationKey(consent, 0), boardPresentationKey(first, 0));
  const second = { ...first, round: 2, game: { ...game, revision: 11 } };
  assert.notEqual(boardPresentationKey(second, 0), boardPresentationKey(first, 0));
  assert.equal(acceptRoomState(first, second), second);
  assert.equal(acceptRoomState(second, { ...first, game: { ...game, revision: 999 } }), second);
  assert.equal(acceptRoomState(second, { ...second, game: { ...game, revision: 10 } }), second);
  assert.equal(acceptRoomState(first, consent), consent);
  assert.notEqual(boardPresentationKey(second, 0), boardPresentationKey(second, 1));
});
