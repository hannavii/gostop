import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAction, createMatch, gameView, parseAction, type Match } from "../game";
import type { GameAction } from "../../shared/online";
import type { HwatuCard } from "../../src/types/game";

const card = (month: number, cardIndex: number): HwatuCard => ({
  id: `${month}-${cardIndex}`, month, cardIndex, category: "pi", tags: [],
});
const action = (match: Match, type: GameAction["type"], cardId?: string): GameAction => ({
  roomCode: "ABC123", revision: match.revision, type, ...(cardId ? { cardId } : {}),
});

test("server distributes 48 unique cards and exposes only the viewer's hand", () => {
  const match = createMatch();
  assert.deepEqual(match.players.map(p => p.hand.length), [10, 10]);
  assert.equal(match.floor.length, 8);
  assert.equal(match.pile.length, 20);
  assert.equal(new Set([...match.players.flatMap(p => p.hand), ...match.floor, ...match.pile].map(c => c.id)).size, 48);
  for (const seat of [0, 1] as const) {
    const view = gameView(match, seat);
    assert.deepEqual(view.hand, match.players[seat].hand);
    const serialized = JSON.stringify(view);
    for (const hidden of [...match.players[seat === 0 ? 1 : 0].hand, ...match.pile]) {
      assert.ok(!serialized.includes(`"id":"${hidden.id}"`));
    }
    view.hand.pop();
    assert.equal(match.players[seat].hand.length, 10);
  }
});

test("invalid payload, wrong turn, foreign card and stale revision are rejected atomically", () => {
  for (const input of [null, [], {}, { roomCode: "ABC123", revision: 0, type: "win" },
    { roomCode: "ABC123", revision: 0, type: "play", cardId: "1", seat: 0 }]) {
    assert.throws(() => parseAction(input));
  }
  const match = createMatch();
  const before = structuredClone(match);
  assert.throws(() => applyAction(match, 1, action(match, "play", match.players[1].hand[0].id)));
  assert.throws(() => applyAction(match, 0, action(match, "play", match.players[1].hand[0].id)));
  assert.throws(() => applyAction(match, 0, action(match, "stop")));
  assert.deepEqual(match, before);
  const move = action(match, "play", match.players[0].hand[0].id);
  const next = applyAction(match, 0, move);
  assert.equal(next.revision, 1);
  assert.throws(() => applyAction(next, 0, move));
});

test("hand choice stays on the acting player, hides candidates from opponent and resolves ttadak", () => {
  const match = createMatch();
  match.players[0].hand = [card(1, 3), card(3, 1)];
  match.floor = [card(1, 1), card(1, 2)];
  match.pile = [card(1, 4), card(4, 1)];
  const next = applyAction(match, 0, action(match, "play", "1-3"));
  assert.equal(next.phase, "choose");
  assert.equal(next.turn, 0);
  assert.equal(next.pile.length, 2);
  assert.equal(gameView(next, 0).choice?.length, 2);
  assert.equal(gameView(next, 1).choice, null);
  assert.throws(() => applyAction(next, 0, action(next, "choose", "3-1")));
  assert.throws(() => applyAction(next, 0, action(next, "play", "3-1")));
  const complete = applyAction(next, 0, action(next, "choose", "1-1"));
  assert.equal(complete.phase, "play");
  assert.equal(complete.turn, 1);
  assert.deepEqual(complete.events, ["ttadak", "pansseul"]);
});

test("draw choice cannot be skipped and chosen capture is included exactly once", () => {
  const match = createMatch();
  match.players[0].hand = [card(1, 2), card(3, 1)];
  match.floor = [card(1, 1), card(2, 1), card(2, 2)];
  match.pile = [card(2, 3), card(4, 1)];
  const next = applyAction(match, 0, action(match, "play", "1-2"));
  assert.equal(next.pending?.kind, "draw");
  assert.equal(next.players[0].captured.length, 0);
  const complete = applyAction(next, 0, action(next, "choose", "2-2"));
  assert.deepEqual(complete.players[0].captured.map(c => c.id).sort(), ["1-1", "1-2", "2-2", "2-3"]);
  assert.deepEqual(complete.floor.map(c => c.id), ["2-1"]);
  assert.equal(complete.pending, null);
});

test("GO/STOP uses post-capture score and STOP uses the existing settlement engine", () => {
  const match = createMatch();
  match.players[0].captured = Array.from({ length: 14 }, (_, i) => card(i + 10, 1));
  match.players[0].hand = [card(1, 2), card(3, 1)];
  match.floor = [card(1, 1)];
  match.pile = [card(2, 1)];
  const next = applyAction(match, 0, action(match, "play", "1-2"));
  assert.equal(next.phase, "go-stop");
  assert.equal(gameView(next, 0).players[0].score, 7);
  const go = applyAction(next, 0, action(next, "go"));
  assert.equal(go.players[0].goCount, 1);
  assert.equal(go.players[0].lastGoScore, 7);
  assert.equal(go.turn, 1);
  const stop = applyAction(next, 0, action(next, "stop"));
  assert.equal(stop.phase, "finished");
  assert.equal(stop.result?.winner, 0);
  assert.equal(stop.result?.settlement?.baseScore, 7);
  assert.throws(() => applyAction(stop, 0, action(stop, "go")));
});

test("exhausted hands/pile finish in a draw without changing last-turn sweep rewards", () => {
  const match = createMatch();
  match.players[0].hand = [card(1, 2)];
  match.players[1].hand = [];
  match.floor = [card(1, 1), card(2, 1)];
  match.pile = [card(2, 2)];
  match.players[1].captured = [card(3, 1)];
  const next = applyAction(match, 0, action(match, "play", "1-2"));
  assert.equal(next.phase, "finished");
  assert.equal(next.result?.winner, "draw");
  assert.deepEqual(next.events, ["pansseul"]);
  assert.equal(next.players[1].captured.length, 1);
});
