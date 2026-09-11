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

function specialMatch(bomb = true) {
  const match = createMatch();
  match.players[0].hand = [card(1, 1), card(1, 2), card(1, 3)];
  match.players[1].hand = [card(5, 1), card(6, 1), card(7, 1)];
  match.players[1].captured = [card(8, 1), card(8, 2), card(9, 1)];
  match.floor = bomb ? [card(1, 4), card(2, 1)] : [card(2, 1)];
  match.pile = [card(2, 2), card(3, 1), card(3, 2), card(4, 1), card(4, 2), card(10, 1)];
  return match;
}

test("server offers private bomb/shake options; normal play declines without counters", () => {
  for (const bomb of [true, false]) {
    const match = specialMatch(bomb);
    assert.deepEqual(gameView(match, 0).specialOptions, match.players[0].hand.map(c => ({ cardId: c.id, type: bomb ? "bomb" : "shake" })));
    assert.deepEqual(gameView(match, 1).specialOptions, []);
    const next = applyAction(match, 0, action(match, "play", "1-1"));
    assert.equal(next.players[0].hand.length, 2);
    assert.equal(next.players[0].bombCount, 0);
    assert.deepEqual(next.players[0].shakeMonths, []);
  }
});

test("bomb captures once, stacks sweep reward, creates two passes and finishes a full round", () => {
  let match = specialMatch();
  match = applyAction(match, 0, action(match, "bomb", "1-2"));
  assert.deepEqual(match.events, ["bomb", "pansseul"]);
  assert.equal(match.players[0].captured.length, 8);
  assert.equal(match.players[1].captured.length, 1);
  assert.equal(match.players[0].bombCount, 1);
  assert.equal(match.players[0].bombPassCount, 2);
  assert.equal(match.players[0].hand.length, 0);
  assert.equal(match.pile.length, 5);
  for (let i = 0; i < 10 && match.phase !== "finished"; i++) {
    const p = match.players[match.turn];
    match = applyAction(match, match.turn, action(match, p.hand.length ? "play" : "bomb-pass", p.hand[0]?.id));
  }
  assert.equal(match.phase, "finished");
  assert.equal(match.players[0].bombPassCount, 0);
});

test("bomb draw choice preserves captures and reward until completion, no premature sweep", () => {
  const match = specialMatch();
  match.floor.push(card(2, 3));
  const next = applyAction(match, 0, action(match, "bomb", "1-1"));
  assert.equal(next.phase, "choose");
  assert.equal(next.players[0].captured.length, 0);
  assert.deepEqual(gameView(next, 0).specialOptions, []);
  assert.throws(() => applyAction(next, 0, action(next, "bomb-pass")));
  const done = applyAction(next, 0, action(next, "choose", "2-1"));
  assert.deepEqual(done.events, ["bomb"]);
  assert.equal(done.players[0].captured.length, 7);
  assert.equal(new Set(done.players[0].captured.map(c => c.id)).size, 7);
  const miss = specialMatch();
  miss.pile[0] = card(11, 1);
  assert.deepEqual(applyAction(miss, 0, action(miss, "bomb", "1-1")).events, ["bomb"]);
});

test("shake publishes month/count to both seats, preserves jjok and uses settlement multiplier", () => {
  const match = specialMatch(false);
  match.floor = [];
  match.pile[0] = card(1, 4);
  match.players[0].captured = Array.from({ length: 14 }, (_, i) => card(20 + i, 1));
  const next = applyAction(match, 0, action(match, "shake", "1-1"));
  assert.deepEqual(next.events, ["shake", "jjok", "pansseul"]);
  for (const seat of [0, 1] as const) assert.deepEqual(gameView(next, seat).players[0].shakeMonths, [1]);
  assert.ok(!JSON.stringify(gameView(next, 1)).includes('"id":"1-2"'));
  assert.equal(next.phase, "go-stop");
  next.players[0].bombCount = 1;
  const stopped = applyAction(next, 0, action(next, "stop"));
  assert.equal(stopped.result?.settlement?.winnerShakeCount, 1);
  assert.equal(stopped.result?.settlement?.winnerBombCount, 1);
  assert.equal(stopped.result?.settlement?.multipliers.find(m => m.id === "shake-bomb")?.multiplier, 4);
});

test("special action validation rejects forged conditions, phase, replay and counters atomically", () => {
  const match = specialMatch();
  const before = structuredClone(match);
  for (const move of [action(match, "shake", "1-1"), action(match, "bomb", "5-1"), action(match, "bomb-pass")]) {
    assert.throws(() => applyAction(match, 0, move));
  }
  assert.throws(() => applyAction(match, 1, action(match, "bomb", "1-1")));
  assert.deepEqual(match, before);
  for (const type of ["bomb", "shake"] as const) assert.throws(() => parseAction(action(match, type)));
  assert.throws(() => parseAction(action(match, "bomb-pass", "1-1")));
  assert.throws(() => parseAction({ ...action(match, "bomb", "1-1"), bombPassCount: 99 }));
  const move = action(match, "bomb", "1-1");
  const next = applyAction(match, 0, move);
  assert.throws(() => applyAction(next, 0, move));
  const shake = specialMatch(false);
  shake.players[0].shakeMonths = [1];
  assert.deepEqual(gameView(shake, 0).specialOptions, []);
  assert.throws(() => applyAction(shake, 0, action(shake, "shake", "1-1")));
});

test("passes may precede hand play and preserve ppeok capture and last-action sweep rules", () => {
  for (const remaining of [0, 1]) {
    const match = specialMatch(false);
    match.players[0].hand = remaining ? [card(10, 2)] : [];
    match.players[0].bombPassCount = 1;
    match.floor = [card(3, 1), card(3, 2), card(3, 3)];
    match.pile = [card(3, 4), card(11, 1)];
    match.ppeokStacks = [{ month: 3, owner: 0 }];
    const next = applyAction(match, 0, action(match, "bomb-pass"));
    assert.equal(next.players[0].hand.length, remaining);
    assert.equal(next.players[0].bombPassCount, 0);
    assert.deepEqual(next.events, ["bomb-pass", "self-ppeok-capture", "pansseul"]);
    assert.equal(next.players[1].captured.length, remaining ? 0 : 1);
    assert.deepEqual(next.ppeokStacks, []);
  }
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

test("special-action rounds conserve all 48 cards and consume exactly one draw per turn", () => {
  for (let round = 0; round < 50; round++) {
    let match = createMatch();
    for (let step = 0; step < 100 && match.phase !== "finished"; step++) {
      const view = gameView(match, match.turn);
      const option = view.specialOptions[0];
      const type = match.phase === "choose" ? "choose" : match.phase === "go-stop" ? "go"
        : option ? option.type : match.players[match.turn].bombPassCount ? "bomb-pass" : "play";
      const cardId = type === "choose" ? view.choice![0].id : type === "play" ? view.hand[0].id : option?.cardId;
      const beforeDraw = match.pile.length;
      match = applyAction(match, match.turn, action(match, type, type === "go" || type === "bomb-pass" ? undefined : cardId));
      assert.ok(beforeDraw - match.pile.length <= 1);
      if (match.pending) continue;
      const cards = [...match.players.flatMap(p => [...p.hand, ...p.captured]), ...match.floor, ...match.pile];
      assert.equal(cards.length, 48);
      assert.equal(new Set(cards.map(c => c.id)).size, 48);
    }
    assert.equal(match.phase, "finished");
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
