import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAction, createMatch, gameView, type Match } from "../game";
import { calculateGostopSettlement } from "../../src/game/gostopSettlement";
import type { GameAction, Seat } from "../../shared/online";
import type { HwatuCard } from "../../src/types/game";

const seats = [0, 1, 2] as const;
const card = (month: number, cardIndex: number): HwatuCard => ({ id: `${month}-${cardIndex}`, month, cardIndex, category: "pi", tags: [] });
const action = (m: Match, type: GameAction["type"], cardId?: string): GameAction => ({
  roomCode: "ABC123", revision: m.revision, type, ...(cardId ? { cardId } : {}),
});
function fixture(actor: Seat = 0) {
  const m = createMatch("gostop");
  m.turn = actor;
  m.players.forEach((p, i) => {
    p.hand = [card(7 + i, 1), card(7 + i, 2)];
    p.captured = [];
  });
  m.floor = [];
  m.pile = [card(11, 1), card(12, 1), card(10, 1)];
  return m;
}
function assertPrivate(m: Match) {
  for (const viewer of seats) {
    const view = gameView(m, viewer);
    assert.deepEqual(view.hand, m.players[viewer].hand);
    assert.equal(view.players.length, 3);
    assert.ok(view.players.every(p => !("hand" in p)));
    const serialized = JSON.stringify(view);
    for (const hidden of [...m.pile, ...m.players.flatMap((p, i) => i === viewer ? [] : p.hand)]) {
      assert.ok(!serialized.includes(`"${hidden.id}"`), `seat ${viewer} leaked ${hidden.id}`);
    }
    if (viewer !== m.turn) {
      assert.deepEqual(view.specialOptions, []);
      assert.equal(view.choice, null);
    }
  }
}

test("gostop deals 7/7/7 + 6 + 21 unique cards and isolates all three hands", () => {
  const m = createMatch("gostop");
  assert.equal(m.mode, "gostop");
  assert.deepEqual(m.players.map(p => p.hand.length), [7, 7, 7]);
  assert.equal(m.floor.length, 6);
  assert.equal(m.pile.length, 21);
  assert.equal(new Set([...m.players.flatMap(p => p.hand), ...m.floor, ...m.pile].map(c => c.id)).size, 48);
  assertPrivate(m);
  const view = gameView(m, 2);
  view.hand.pop(); view.players[0].shakeMonths.push(12);
  assert.equal(m.players[2].hand.length, 7);
  assert.deepEqual(m.players[0].shakeMonths, []);
});

test("gostop validates 0 → 1 → 2 → 0, ownership, phase, stale revision atomically", () => {
  let m = fixture();
  for (const actor of seats) {
    assert.equal(m.turn, actor);
    const before = structuredClone(m);
    const move = action(m, "play", m.players[actor].hand[0].id);
    for (const wrong of seats.filter(s => s !== actor)) {
      assert.throws(() => applyAction(m, wrong, move));
      assert.throws(() => applyAction(m, actor, action(m, "play", m.players[wrong].hand[0].id)));
    }
    assert.throws(() => applyAction(m, actor, action(m, "stop")));
    assert.deepEqual(m, before);
    m = applyAction(m, actor, move);
    assert.throws(() => applyAction(m, m.turn, move));
  }
  assert.equal(m.turn, 0);
  assert.equal(m.revision, 3);
});

test("gostop ppeok ownership, jjok, ttadak and sweep rewards apply to both opponents", () => {
  for (const actor of seats) {
    for (const event of ["ppeok", "jjok", "ttadak"] as const) {
      let m = fixture(actor);
      m.players[actor].hand = [card(1, 1), card(6, 1)];
      m.players.forEach((p, i) => { if (i !== actor) p.captured = [card(20 + i, 1), card(20 + i, 2)]; });
      m.floor = event === "ppeok" ? [card(1, 2)] : event === "ttadak" ? [card(1, 2), card(1, 3)] : [];
      m.pile = [card(1, 4), card(12, 1)];
      m = applyAction(m, actor, action(m, "play", "1-1"));
      if (event === "ttadak") {
        assert.equal(m.phase, "choose");
        assert.equal(m.turn, actor);
        assertPrivate(m);
        assert.throws(() => applyAction(m, actor, action(m, "play", "6-1")));
        m = applyAction(m, actor, action(m, "choose", "1-2"));
      }
      assert.deepEqual(m.events, event === "ppeok" ? [event] : [event, "pansseul"]);
      for (const s of seats.filter(s => s !== actor)) assert.equal(m.players[s].captured.length, event === "ppeok" ? 2 : 0);
      assert.deepEqual(m.ppeokStacks, event === "ppeok" ? [{ month: 1, owner: actor }] : []);
    }
  }
});

test("gostop pass distinguishes own/other ppeok, insufficient pi and last-turn sweep", () => {
  for (const owner of seats) {
    const m = fixture(2);
    m.players[2].hand = [];
    m.players[2].bombPassCount = 1;
    m.players[0].captured = [card(5, 1), card(5, 2)];
    m.players[1].captured = [{ ...card(6, 1), tags: ["double-pi"] }];
    m.floor = [card(1, 1), card(1, 2), card(1, 3)];
    m.ppeokStacks = [{ month: 1, owner }];
    m.pile = [card(1, 4)];
    const next = applyAction(m, 2, action(m, "bomb-pass"));
    assert.deepEqual(next.events, ["bomb-pass", owner === 2 ? "self-ppeok-capture" : "ppeok-capture", "pansseul"]);
    assert.equal(next.players[0].captured.length, owner === 2 ? 0 : 1);
    assert.equal(next.players[1].captured.length, 0);
    assert.deepEqual(next.ppeokStacks, []);
    assert.equal(next.players[2].bombPassCount, 0);
    assert.throws(() => applyAction({ ...next, turn: 2, phase: "play" }, 2, action(next, "bomb-pass")));
  }
});

test("gostop private bomb/shake offers, decline, draw choice and repeat declaration rejection", () => {
  for (const actor of seats) for (const type of ["bomb", "shake"] as const) {
    const m = fixture(actor);
    m.players[actor].hand = [card(1, 1), card(1, 2), card(1, 3)];
    m.floor = type === "bomb" ? [card(1, 4), card(2, 1), card(2, 2)] : [card(2, 1), card(2, 2)];
    m.pile = [card(2, 3), card(3, 1)];
    m.players.forEach((p, i) => { if (i !== actor) p.captured = [card(20 + i, 1)]; });
    assertPrivate(m);
    assert.deepEqual(gameView(m, actor).specialOptions.map(o => o.type), [type, type, type]);
    const normal = applyAction(m, actor, action(m, "play", "1-1"));
    assert.equal(normal.players[actor].bombCount, 0);
    assert.deepEqual(normal.players[actor].shakeMonths, []);
    const pending = applyAction(m, actor, action(m, type, "1-1"));
    assert.equal(pending.phase, "choose");
    assertPrivate(pending);
    assert.throws(() => applyAction(pending, actor, action(pending, "bomb-pass")));
    const next = applyAction(pending, actor, action(pending, "choose", "2-1"));
    assert.deepEqual(next.events, [type]);
    assert.equal(next.players[actor].bombPassCount, type === "bomb" ? 2 : 0);
    assert.equal(next.players[actor].captured.length, type === "bomb" ? 8 : 2);
    assert.deepEqual(gameView(next, (actor + 1) % 3 as Seat).players[actor].shakeMonths, type === "shake" ? [1] : []);
    if (type === "shake") {
      m.players[actor].shakeMonths = [1];
      assert.throws(() => applyAction(m, actor, action(m, "shake", "1-1")));
      assert.deepEqual(gameView(m, actor).specialOptions, []);
    }
  }
});

test("gostop GO starts at 3, records threshold and STOP uses per-loser gobak settlement", () => {
  for (const actor of seats) {
    const m = fixture(actor);
    m.players[actor].captured = Array.from({ length: 10 }, (_, i) => card(20 + i, 1));
    m.players[actor].hand = [card(1, 1), card(6, 1)];
    m.players[actor].shakeMonths = [5];
    m.players[actor].bombCount = 1;
    const payer = ((actor + 1) % 3) as Seat;
    m.players[payer].goCount = 1;
    m.floor = [card(1, 2)];
    const next = applyAction(m, actor, action(m, "play", "1-1"));
    assert.equal(next.phase, "go-stop");
    assert.equal(gameView(next, actor).players[actor].score, 3);
    assert.throws(() => applyAction(next, payer, action(next, "stop")));
    const go = applyAction(next, actor, action(next, "go"));
    assert.equal(go.turn, payer);
    assert.equal(go.players[actor].lastGoScore, 3);
    assert.equal(go.players[actor].goCount, 1);
    const stopped = applyAction(next, actor, action(next, "stop"));
    const result = stopped.result!.gostopSettlement!;
    assert.equal(stopped.phase, "finished");
    assert.equal(stopped.result!.settlement, null);
    assert.equal(result.goBakPayer, payer);
    assert.equal(result.winnerMultiplier, 4);
    assert.equal(result.totalReceived, 48);
    assert.equal(result.loserSettlements.find(p => p.loser === payer)?.payment, 48);
    assert.equal(result.loserSettlements.find(p => p.loser !== payer)?.payment, 0);
    assert.deepEqual(result, calculateGostopSettlement({ winner: actor, players: next.players.map((p, index) => ({
      index: index as Seat, cards: p.captured, goCount: p.goCount, shakeCount: p.shakeMonths.length, bombCount: p.bombCount,
    })) }));
    assert.throws(() => applyAction(stopped, actor, action(stopped, "go")));
  }
});

test("gostop full rounds conserve 48 cards, finish and protect private state after every action", () => {
  for (let round = 0; round < 40; round++) {
    let m = createMatch("gostop");
    for (let step = 0; step < 100 && m.phase !== "finished"; step++) {
      assertPrivate(m);
      const view = gameView(m, m.turn), option = view.specialOptions[0];
      const type = m.phase === "choose" ? "choose" : m.phase === "go-stop" ? "go"
        : option ? option.type : m.players[m.turn].bombPassCount ? "bomb-pass" : "play";
      const id = type === "choose" ? view.choice![0].id : type === "play" ? view.hand[0].id
        : type === "bomb" || type === "shake" ? option!.cardId : undefined;
      const before = m.pile.length;
      m = applyAction(m, m.turn, action(m, type, id));
      assert.ok(before - m.pile.length <= 1);
      if (m.pending) continue;
      const cards = [...m.players.flatMap(p => [...p.hand, ...p.captured]), ...m.floor, ...m.pile];
      assert.equal(cards.length, 48);
      assert.equal(new Set(cards.map(c => c.id)).size, 48);
    }
    assert.equal(m.phase, "finished");
    assert.equal(m.result?.winner, "draw");
  }
});
