import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OnlineGameBoard from "../src/online/OnlineGameBoard";
import CapturedCardsModal from "../src/components/CapturedCardsModal";
import MatgoTable from "../src/components/MatgoTable";
import { hwatuCards } from "../src/data/cards";
import type { GameView, Seat } from "../shared/online";
import { createMatch, gameView } from "../server/game";
import { calculateGostopSettlement } from "../src/game/gostopSettlement";

function fixture(): GameView {
  return {
    mode: "matgo", revision: 1, turn: 0, phase: "play", hand: hwatuCards.slice(0, 2),
    players: [
      { seat: 0, handCount: 2, captured: [], score: 17, goCount: 2, bombCount: 1, bombPassCount: 2, shakeMonths: [1] },
      { seat: 1, handCount: 7, captured: [], score: 19, goCount: 3, bombCount: 0, bombPassCount: 0, shakeMonths: [] },
    ],
    floor: hwatuCards.slice(4, 7), drawCount: 10, choice: null,
    revealed: [], specialEvents: [], ppeokStacks: [], result: null, specialOptions: [],
  };
}
function board(game: GameView, you: Seat = 0, names?: string[]) {
  return renderToStaticMarkup(createElement(OnlineGameBoard, {
    game, room: { code: "ABC123", mode: game.mode, capacity: game.players.length, host: 0, you, occupancy: game.players.length,
      connections: game.players.map(p => ({ seat: p.seat, nickname: names?.[p.seat] ?? (p.seat === you ? "나" : game.mode === "gostop" ? `상대 ${(p.seat - you + 3) % 3}` : "상대방"), ready: true, connected: true, reconnectDeadline: null })), game }, enabled: true,
    message: "", act() {}, onSync() {}, onLeave() {},
  }));
}

test("online board displays server nicknames, host and connection labels with escaped user content", () => {
  for (const mode of ["matgo", "gostop"] as const) {
    const match = createMatch(mode);
    const names = ["예랑", "<철수>", "영희"];
    for (const you of match.players.map((_, i) => i as Seat)) {
      const html = board(gameView(match, you), you, names);
      assert.ok(html.includes("예랑"));
      assert.ok(html.includes("&lt;철수&gt;"));
      assert.ok(!html.includes("<철수>"));
      assert.match(html, /aria-label="방장"/);
      assert.equal((html.match(/접속 중/g) ?? []).length, match.players.length);
      if (mode === "gostop") assert.ok(html.includes("영희"));
    }
  }
});
test("online uses shared table, captured panels, speed and authoritative scores for both seats", () => {
  for (const seat of [0, 1] as const) {
    const html = board(fixture(), seat);
    for (const name of ["game online-matgo-game", "opponent-area", "player-area", "table-content", "draw-pile-area", "captured-panel--left", "captured-panel--right"]) assert.ok(html.includes(name), name);
    assert.match(html, /--special-effect-duration:900ms/);
    assert.match(html, /17점/);
    assert.match(html, /19점/);
    assert.match(html, /2 GO/);
    assert.match(html, /3 GO/);
    const opponentHand = html.split('aria-label="상대 손패">')[1].split('</section>')[0];
    assert.equal((opponentHand.match(/class="card-back"/g) ?? []).length, seat === 0 ? 7 : 2);
    assert.ok(!opponentHand.includes('class="card '));
  }
});
test("floor choices and GO/STOP are shown only to the acting seat", () => {
  const game = fixture();
  game.phase = "choose";
  game.choice = game.floor.slice(0, 2);
  assert.equal((board(game).match(/selectable/g) ?? []).length, 2);
  assert.equal((board(game, 1).match(/selectable/g) ?? []).length, 0);
  game.phase = "go-stop";
  game.choice = null;
  assert.match(board(game), /go-stop-modal/);
  assert.ok(!board(game, 1).includes('go-stop-modal'));
});

test("server shake records and bomb passes render for both seats with action only on own turn", () => {
  const game = fixture();
  assert.match(board(game), /폭탄 패 사용 · 더미만 뒤집기 \(2\)/);
  assert.ok(!board(game, 1).includes('bomb-pass-button'));
  for (const seat of [0, 1] as const) {
    assert.match(board(game, seat), /흔들기 공개/);
    assert.match(board(game, seat), /1월/);
  }
  game.phase = "choose";
  assert.ok(!board(game).includes('bomb-pass-button'));
});
test("online captured modal uses server score without recalculating empty captured cards", () => {
  const html = renderToStaticMarkup(createElement(CapturedCardsModal, {
    title: "내 먹은 패", cards: [], totalScore: 123, onClose() {},
  }));
  assert.match(html, /123점/);
});
test("shared table preserves ppeok grouping, expanded detail and played-card overlay", () => {
  const cards = hwatuCards.filter(card => card.month === 1);
  const html = renderToStaticMarkup(createElement(MatgoTable, {
    floorCards: cards.slice(0, 3), ppeokStacks: [{ month: 1, owner: "player" }],
    expandedPpeokMonth: 1, setExpandedPpeokMonth() {}, pendingChoice: null,
    gameStarted: true, gameOver: false, isAnimating: false, turnMessage: "",
    drawCount: 5, handleFloorCardChoice() {},
  }));
  assert.match(html, /ppeok-stack-slot is-open/);
  assert.match(html, /내가 만든 뻑/);
  assert.match(html, /ppeok-stack-detail-cards/);
  const overlay = renderToStaticMarkup(createElement(MatgoTable, {
    floorCards: cards.slice(0, 1), ppeokStacks: [], expandedPpeokMonth: null,
    setExpandedPpeokMonth() {}, pendingChoice: null, gameStarted: true,
    gameOver: false, isAnimating: true, turnMessage: "", drawCount: 5,
    pendingPlayedVisual: { card: cards[1], targetCardId: cards[0].id, owner: "player" },
    handleFloorCardChoice() {},
  }));
  assert.match(overlay, /played-card-overlay--player/);
});

test("three-seat board rotates opponents, uses all captured panels and hides both hands", () => {
  const match = createMatch("gostop");
  match.players[0].hand.pop();
  match.players[2].hand.pop(); match.players[2].hand.pop();
  match.ppeokStacks = [{ month: match.floor[0].month, owner: 2 }];
  for (const you of [0, 1, 2] as const) {
    const view = gameView(match, you), html = board(view, you);
    for (const cls of ["gostop3-game", "gostop3-opponents-area", "gostop3-table", "gostop3-player-area",
      "gostop3-captured-panel--opponent1", "gostop3-captured-panel--opponent2", "gostop3-captured-panel--player"]) assert.ok(html.includes(cls), cls);
    for (const relative of [1, 2]) {
      const hand = html.split(`aria-label="상대 ${relative} 손패">`)[1].split('</div>')[0];
      // Card backs are empty divs; count across the full hand block up to its status paragraph.
      const block = html.split(`aria-label="상대 ${relative} 손패">`)[1].split('<p>')[0];
      assert.equal((block.match(/class="card-back"/g) ?? []).length, match.players[(you + relative) % 3].hand.length);
      assert.ok(!hand.includes('class="card '));
    }
    assert.match(html, /3\/3명/);
    assert.ok(html.includes(`${you === 2 ? "나" : `상대 ${(2 - you + 3) % 3}`}가 만든 뻑`));
  }
});

test("three-seat choices and GO/STOP belong only to actor; settlement names rotate with viewer", () => {
  const match = createMatch("gostop");
  match.turn = 2;
  match.phase = "go-stop";
  for (const you of [0, 1, 2] as const) assert.equal(board(gameView(match, you), you).includes('go-stop-modal'), you === 2);
  match.phase = "choose";
  match.pending = { kind: "hand", card: match.players[2].hand[0], matches: match.floor.slice(0, 2) };
  for (const you of [0, 1, 2] as const) assert.equal((board(gameView(match, you), you).match(/selectable/g) ?? []).length, you === 2 ? 2 : 0);
  match.pending = null;
  match.phase = "finished";
  match.players[0].goCount = 1;
  match.result = { winner: 2, settlement: null, gostopSettlement: calculateGostopSettlement({
    winner: 2, players: match.players.map((p, i) => ({ index: i as Seat, cards: p.captured,
      goCount: p.goCount, shakeCount: 0, bombCount: 0 })),
  }) };
  for (const you of [0, 1, 2] as const) {
    const html = board(gameView(match, you), you);
    assert.match(html, /gostop3-settlement-panel/);
    assert.match(html, /고박 대납/);
    assert.match(html, /총 획득/);
    const payer = you === 0 ? "나" : `상대 ${(3 - you) % 3}`;
    assert.ok(html.includes(`${payer} 고박:`));
  }
});
